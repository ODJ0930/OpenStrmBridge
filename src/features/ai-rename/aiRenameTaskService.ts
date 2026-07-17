import { getApiBaseUrl } from '../../shared/config/runtimeConfig'
import type {
  AiRenameJob,
  AiRenameManagedTask,
  AiRenameManagedTaskInput,
} from '../../shared/types/domain'

export interface AiRenameTaskRunResponse {
  job: AiRenameJob
  task: AiRenameManagedTask
}

export interface AiRenameTaskRunAllResponse {
  results: Array<AiRenameTaskRunResponse | { error: string; task: AiRenameManagedTask }>
  tasks: AiRenameManagedTask[]
}

const backendBaseUrl = getApiBaseUrl()
const tasksUrl = `${backendBaseUrl}/api/ai-rename/tasks`
let mockTasks: AiRenameManagedTask[] = []

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

function createMockJob(task: AiRenameManagedTask): AiRenameJob {
  const now = new Date().toISOString()

  return {
    allowMove: task.allowMove,
    createdAt: now,
    currentPath: task.path,
    id: `test-job-${task.id}`,
    message: 'AI 已返回整批建议，正在逐项修改第 1/1 个目录',
    path: task.path,
    progress: {
      analyzed: 1,
      completedOperations: 0,
      failed: 0,
      ignored: 0,
      processedGroups: 0,
      scanned: 2,
      skipped: 0,
      succeeded: 0,
      totalGroups: 1,
      totalOperations: 0,
    },
    results: [
      {
        action: 'inventory',
        at: now,
        message: '已汇总 1 个逻辑媒体组、2 个条目，AI 已一次性返回修改建议',
        oldPath: task.path,
        status: 'info',
      },
      {
        action: 'directory',
        at: now,
        message: '开始执行 AI 建议（1/1）',
        oldPath: task.path,
        status: 'info',
      },
    ],
    stage: 'executing',
    startedAt: now,
    status: 'running',
    storageId: task.storageId,
    taskId: task.id,
    useTmdb: task.useTmdb,
  }
}

export const aiRenameTaskService = {
  async list(): Promise<AiRenameManagedTask[]> {
    if (import.meta.env.MODE === 'test') {
      return mockTasks.map((task) => ({ ...task }))
    }

    return readJsonResponse<AiRenameManagedTask[]>(await fetch(tasksUrl))
  },
  async save(input: AiRenameManagedTaskInput): Promise<AiRenameManagedTask> {
    if (import.meta.env.MODE === 'test') {
      const existing = mockTasks.find((task) => task.id === input.id)
      const now = new Date().toISOString()
      const task: AiRenameManagedTask = {
        ...existing,
        ...input,
        createdAt: existing?.createdAt ?? now,
        status: existing?.status ?? 'idle',
        updatedAt: now,
      }
      mockTasks = existing
        ? mockTasks.map((item) => (item.id === input.id ? task : item))
        : [...mockTasks, task]
      return { ...task }
    }

    return readJsonResponse<AiRenameManagedTask>(
      await fetch(`${tasksUrl}/${encodeURIComponent(input.id)}`, {
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
        method: 'PUT',
      }),
    )
  },
  async remove(taskId: string): Promise<void> {
    if (import.meta.env.MODE === 'test') {
      mockTasks = mockTasks.filter((task) => task.id !== taskId)
      return
    }

    await readJsonResponse(
      await fetch(`${tasksUrl}/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),
    )
  },
  async run(taskId: string): Promise<AiRenameTaskRunResponse> {
    if (import.meta.env.MODE === 'test') {
      const task = mockTasks.find((item) => item.id === taskId)
      if (!task) throw new Error('未找到 AI 重命名任务')
      const job = createMockJob(task)
      const nextTask = { ...task, currentJobId: job.id, lastJob: job, status: 'running' as const }
      mockTasks = mockTasks.map((item) => (item.id === taskId ? nextTask : item))
      return { job, task: nextTask }
    }

    return readJsonResponse<AiRenameTaskRunResponse>(
      await fetch(`${tasksUrl}/${encodeURIComponent(taskId)}/run`, { method: 'POST' }),
    )
  },
  async runAll(): Promise<AiRenameTaskRunAllResponse> {
    if (import.meta.env.MODE === 'test') {
      const results = await Promise.all(mockTasks.map((task) => this.run(task.id)))
      return { results, tasks: mockTasks.map((task) => ({ ...task })) }
    }

    return readJsonResponse<AiRenameTaskRunAllResponse>(
      await fetch(`${tasksUrl}/run-all`, { method: 'POST' }),
    )
  },
  async stop(taskId: string): Promise<AiRenameTaskRunResponse> {
    if (import.meta.env.MODE === 'test') {
      const task = mockTasks.find((item) => item.id === taskId)
      if (!task) throw new Error('未找到 AI 重命名任务')
      const job = { ...(task.lastJob ?? createMockJob(task)), message: '正在停止任务' }
      return { job, task }
    }

    return readJsonResponse<AiRenameTaskRunResponse>(
      await fetch(`${tasksUrl}/${encodeURIComponent(taskId)}/stop`, { method: 'POST' }),
    )
  },
  async getResult(taskId: string): Promise<AiRenameJob | null> {
    if (import.meta.env.MODE === 'test') {
      return mockTasks.find((task) => task.id === taskId)?.lastJob ?? null
    }

    return readJsonResponse<AiRenameJob | null>(
      await fetch(`${tasksUrl}/${encodeURIComponent(taskId)}/result`),
    )
  },
}
