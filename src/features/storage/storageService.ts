import { getApiBaseUrl } from '../../shared/config/runtimeConfig'
import type { StorageConnectionCheckResult, StorageItem } from '../../shared/types/domain'

export interface StorageService {
  list(): Promise<StorageItem[]>
  save(storage: StorageItem): Promise<StorageItem>
  remove(storageId: string): Promise<void>
  checkConnection(
    storage: StorageItem,
    options?: StorageConnectionCheckOptions,
  ): Promise<StorageConnectionCheckResult>
}

interface StorageConnectionCheckOptions {
  token?: string
}

const backendBaseUrl = getApiBaseUrl()
const storageUrl = `${backendBaseUrl}/api/storage`
const storageCheckUrl = `${backendBaseUrl}/api/storage/check`

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return '未知错误'
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

async function requestStorageList() {
  const response = await fetch(storageUrl)
  return readJsonResponse<StorageItem[]>(response)
}

async function requestStorageSave(storage: StorageItem) {
  const response = await fetch(`${storageUrl}/${encodeURIComponent(storage.id)}`, {
    body: JSON.stringify(storage),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PUT',
  })

  return readJsonResponse<StorageItem>(response)
}

async function requestStorageDelete(storageId: string) {
  const response = await fetch(`${storageUrl}/${encodeURIComponent(storageId)}`, {
    method: 'DELETE',
  })

  await readJsonResponse<{ ok: boolean; deleted: boolean }>(response)
}

async function requestBackendConnectionCheck(
  storage: StorageItem,
  options?: StorageConnectionCheckOptions,
) {
  const response = await fetch(storageCheckUrl, {
    body: JSON.stringify({
      storage,
      token: options?.token,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  return readJsonResponse<StorageConnectionCheckResult>(response)
}

function createBackendRequiredResult(storage: StorageItem): StorageConnectionCheckResult {
  const methodName =
    storage.accessMethod === 'webdav'
      ? 'WebDAV'
      : storage.accessMethod === 'local'
        ? '本地文件'
        : 'OpenList / Alist'

  return {
    storageId: storage.id,
    method: storage.accessMethod,
    checkedAt: new Date().toISOString(),
    ok: false,
    title: '后端检查服务未启动',
    message: `${methodName} 连通性检查需要本地后端服务。请先运行 pnpm backend:dev，然后重新点击连通性检查。`,
    endpoint: storage.endpoint,
    rootPath: storage.rootPath,
    folders: [],
    files: [],
    requiresBackend: true,
  }
}

export const storageService: StorageService = {
  async list() {
    if (import.meta.env.MODE === 'test') {
      return []
    }

    try {
      return await requestStorageList()
    } catch {
      return []
    }
  },
  save(storage) {
    return requestStorageSave(storage)
  },
  remove(storageId) {
    return requestStorageDelete(storageId)
  },
  async checkConnection(storage, options) {
    try {
      return await requestBackendConnectionCheck(storage, options)
    } catch (error) {
      const result = createBackendRequiredResult(storage)

      return {
        ...result,
        message: `${result.message} 当前错误：${getErrorMessage(error)}`,
      }
    }
  },
}
