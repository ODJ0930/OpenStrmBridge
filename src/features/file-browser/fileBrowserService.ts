import { getApiBaseUrl } from '../../shared/config/runtimeConfig'
import type { FileEntry, FileEntryKind, StorageItem } from '../../shared/types/domain'

export interface FileBrowserService {
  listStorages(): Promise<StorageItem[]>
  listEntries(storageId: string, path: string): Promise<FileEntryBrowseResult>
}

export interface FileEntryBrowseResult {
  path: string
  entries: FileEntry[]
}

interface BackendBrowseEntry {
  id: string
  name: string
  path: string
  kind: FileEntryKind
  size?: number
  updatedAt?: string
}

interface BackendBrowseResult {
  storageId: string
  path: string
  entries: BackendBrowseEntry[]
}

const backendBaseUrl = getApiBaseUrl()
const storageUrl = `${backendBaseUrl}/api/storage`
const browseUrl = `${backendBaseUrl}/api/storage/browse`

const mockStorages: StorageItem[] = [
  {
    id: 'mock-storage',
    name: '示例存储',
    accessMethod: 'openlist',
    endpoint: '',
    rootPath: '/',
    status: 'unchecked',
    openlist: {
      basePath: '/',
      enableUrlEncoding: true,
    },
  },
]

const mockEntriesByPath: Record<string, FileEntry[]> = {
  '/': [
    {
      id: 'folder-guangya',
      name: '光鸭',
      path: '/光鸭',
      kind: 'folder',
      size: '-',
      updatedAt: '2026/6/10 10:06:56',
    },
    {
      id: 'folder-movie',
      name: '电影',
      path: '/电影',
      kind: 'folder',
      size: '-',
      updatedAt: '2026/6/12 13:22:10',
    },
    {
      id: 'poster-file',
      name: 'poster.jpg',
      path: '/poster.jpg',
      kind: 'file',
      size: '248 KB',
      updatedAt: '2026/6/12 13:23:01',
    },
  ],
  '/光鸭/电影': [
    {
      id: 'movie-folder',
      name: '示例电影 (2026)',
      path: '/光鸭/电影/示例电影 (2026)',
      kind: 'folder',
      size: '-',
      updatedAt: '2026/6/20 18:45:11',
    },
    {
      id: 'movie-strm',
      name: '示例电影 (2026).strm',
      path: '/光鸭/电影/示例电影 (2026).strm',
      kind: 'file',
      size: '1 KB',
      updatedAt: '2026/6/20 18:45:12',
    },
  ],
}

function formatFileSize(size: number | undefined) {
  if (typeof size !== 'number') {
    return '-'
  }

  if (size < 1024) {
    return `${size} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function formatUpdatedAt(updatedAt: string | undefined) {
  if (!updatedAt) {
    return '-'
  }

  const date = new Date(updatedAt)

  if (Number.isNaN(date.getTime())) {
    return updatedAt
  }

  return date.toLocaleString('zh-CN', { hour12: false })
}

function toFileEntry(entry: BackendBrowseEntry): FileEntry {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    kind: entry.kind,
    size: entry.kind === 'folder' ? '-' : formatFileSize(entry.size),
    updatedAt: formatUpdatedAt(entry.updatedAt),
  }
}

async function readJsonResponse<T>(response: Response) {
  const payload = (await response.json()) as T | { message?: string }

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? payload.message
        : undefined

    throw new Error(message || `HTTP ${response.status}`)
  }

  return payload as T
}

export const fileBrowserService: FileBrowserService = {
  async listStorages() {
    if (import.meta.env.MODE === 'test') {
      return mockStorages.map((storage) => ({ ...storage, openlist: { ...storage.openlist! } }))
    }

    const response = await fetch(storageUrl)
    return readJsonResponse<StorageItem[]>(response)
  },
  async listEntries(storageId, path) {
    if (import.meta.env.MODE === 'test') {
      return {
        path,
        entries: (mockEntriesByPath[path] ?? mockEntriesByPath['/'] ?? []).map((entry) => ({
          ...entry,
        })),
      }
    }

    const response = await fetch(browseUrl, {
      body: JSON.stringify({
        path,
        storageId,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    const result = await readJsonResponse<BackendBrowseResult>(response)

    return {
      path: result.path,
      entries: result.entries.map((entry) => toFileEntry(entry)),
    }
  },
}
