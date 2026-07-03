import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppProviders } from '../../app/providers'
import type { StorageItem, TaskItem } from '../../shared/types/domain'
import { settingsService } from '../settings/settingsService'
import { storageService } from '../storage/storageService'
import { TaskManagementPage } from './TaskManagementPage'
import { taskService } from './taskService'

vi.mock('./taskService', () => ({
  taskService: {
    getLog: vi.fn(),
    list: vi.fn(),
    remove: vi.fn(),
    run: vi.fn(),
    runAll: vi.fn(),
    save: vi.fn(),
    stop: vi.fn(),
  },
}))

vi.mock('../storage/storageService', () => ({
  storageService: {
    checkConnection: vi.fn(),
    list: vi.fn(),
    remove: vi.fn(),
    save: vi.fn(),
  },
}))

vi.mock('../settings/settingsService', () => ({
  settingsService: {
    createSignSecret: vi.fn(),
    createStrmPreview: vi.fn(),
    createWebhookUrl: vi.fn(),
    getProgramBaseUrl: vi.fn(),
    getProxy302Settings: vi.fn(),
    getStrmSettings: vi.fn(),
    getWebhookSettings: vi.fn(),
    loadSettings: vi.fn(),
    saveProxy302Settings: vi.fn(),
    saveStrmSettings: vi.fn(),
    saveWebhookSettings: vi.fn(),
  },
}))

const storage: StorageItem = {
  accessMethod: 'openlist',
  endpoint: 'http://example.test',
  id: 'storage-1',
  name: '测试2',
  openlist: {
    basePath: '/',
    enableUrlEncoding: true,
  },
  rootPath: '/',
  status: 'connected',
}

const currentTask: TaskItem = {
  directoryTimeCheck: true,
  id: 'task-1',
  incremental: true,
  name: '电影',
  nextRun: '2026-06-30 00:00',
  outputPath: '/opt/openstrmbridge/strm/电影',
  path: '/光鸭/电影',
  preRefreshOpenListCache: true,
  schedule: '0 0 * * *',
  status: 'idle',
  storage: '测试2',
  storageId: 'storage-1',
}

function renderPage() {
  return render(
    <AppProviders>
      <TaskManagementPage />
    </AppProviders>,
  )
}

async function openEditModal(taskName: string) {
  const user = userEvent.setup()
  const taskCell = await screen.findByText(taskName)
  const taskRow = taskCell.closest('tr')

  expect(taskRow).not.toBeNull()

  await user.click(within(taskRow as HTMLElement).getByRole('button', { name: '编辑任务' }))

  return screen.findByRole('dialog', { name: '编辑任务' })
}

describe('TaskManagementPage', () => {
  beforeEach(() => {
    vi.mocked(storageService.list).mockResolvedValue([storage])
    vi.mocked(settingsService.loadSettings).mockResolvedValue({
      emby: {
        apiKey: '',
      },
      proxy302: {
        enabled: true,
        healthy: true,
        mediaServerUrl: '',
        mountPath: '/media/strm',
        servicePort: 8097,
      },
      strm: {
        baseUrl: 'http://localhost:5173',
        cloudNamingMode: '文件编号模式',
        encodeUrl: true,
        mediaExtensions: 'mp4,mkv',
        minMediaSizeMb: 2,
        outputRoot: '/opt/openstrmbridge/strm',
        previewUrl: '',
        sidecarExtensions: 'nfo,jpg',
        signEnabled: true,
        signSecret: 'secret',
        threadCount: 1,
      },
      webhook: {
        embyDeleteSync: true,
        url: 'http://localhost:5174/webhook/secret',
      },
    })
    vi.mocked(taskService.save).mockImplementation(async (task) => task)
  })

  it('prefills the edit form from an existing task', async () => {
    vi.mocked(taskService.list).mockResolvedValue([currentTask])

    renderPage()

    const dialog = await openEditModal('电影')

    expect(within(dialog).getByLabelText('任务名称')).toHaveValue('电影')
    expect(within(dialog).getByText('测试2')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('扫描路径')).toHaveValue('/光鸭/电影')
    expect(within(dialog).getByLabelText('执行时间（Crontab）')).toHaveValue('0 0 * * *')
    expect(within(dialog).getAllByRole('switch')[0]).toBeChecked()
    expect(within(dialog).getAllByRole('switch')[1]).toBeChecked()
    expect(within(dialog).getAllByRole('switch')[2]).toBeChecked()
  })

  it('prefills edit values from legacy task fields', async () => {
    const legacyTask = {
      cron: '30 2 * * *',
      directoryMtimeCheck: false,
      id: 'task-legacy',
      incrementalMode: true,
      name: '旧任务',
      nextRun: '手动运行',
      outputPath: '/opt/openstrmbridge/strm/旧任务',
      preRefreshOpenlistCache: true,
      scanPath: '/光鸭/旧路径',
      status: 'idle',
      storage: '测试2',
    } as unknown as TaskItem

    vi.mocked(taskService.list).mockResolvedValue([legacyTask])

    renderPage()

    const dialog = await openEditModal('旧任务')

    expect(within(dialog).getByLabelText('任务名称')).toHaveValue('旧任务')
    expect(within(dialog).getByText('测试2')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('扫描路径')).toHaveValue('/光鸭/旧路径')
    expect(within(dialog).getByLabelText('执行时间（Crontab）')).toHaveValue('30 2 * * *')
    expect(within(dialog).getAllByRole('switch')[0]).not.toBeChecked()
    expect(within(dialog).getAllByRole('switch')[1]).toBeChecked()
    expect(within(dialog).getAllByRole('switch')[2]).toBeChecked()
  })
})
