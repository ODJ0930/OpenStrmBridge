import { getApiBaseUrl } from '../../shared/config/runtimeConfig'
import type {
  StrmAssistantDefaults,
  StrmAssistantStartResult,
  StrmAssistantStatus,
  StrmAssistantTaskRunResult,
  StrmAssistantTaskSchedule,
} from '../../shared/types/domain'

export interface StrmAssistantService {
  getCachedDefaults(): StrmAssistantDefaults | null
  getDefaults(options?: { force?: boolean }): Promise<StrmAssistantDefaults>
  getTaskRun(taskId: string): Promise<StrmAssistantTaskRunResult>
  runTaskOnce(taskId: string): Promise<StrmAssistantTaskRunResult>
  setPluginDirectory(pluginDirectory: string): Promise<StrmAssistantDefaults>
  setTaskSchedule(schedule: StrmAssistantTaskSchedule): Promise<StrmAssistantDefaults>
  start(): Promise<StrmAssistantStartResult>
}

const backendBaseUrl = getApiBaseUrl()
const strmAssistantUrl = `${backendBaseUrl}/api/strm-assistant`
let cachedDefaults: StrmAssistantDefaults | null = null
let pendingDefaults: Promise<StrmAssistantDefaults> | null = null

async function readJsonResponse<T>(response: Response) {
  const payload = (await response.json()) as T | { message?: string }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('神医助手任务接口未加载，请重启或更新 OpenStrmBridge 后再执行。')
    }

    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? payload.message
        : undefined

    throw new Error(message || `HTTP ${response.status}`)
  }

  return payload as T
}

function cacheDefaults(defaults: StrmAssistantDefaults) {
  cachedDefaults = defaults
  return defaults
}

function cacheStatus(status: StrmAssistantStatus) {
  cachedDefaults = {
    containerPluginDirectory: status.containerPluginDirectory,
    embyContainerName: status.embyContainerName,
    pluginDirectory: status.pluginDirectory,
    sourceFile: status.sourceFile,
    status,
  }
}

export const strmAssistantService: StrmAssistantService = {
  getCachedDefaults() {
    return cachedDefaults
  },
  async getDefaults(options = {}) {
    if (!options.force && cachedDefaults) {
      return cachedDefaults
    }

    if (!options.force && pendingDefaults) {
      return pendingDefaults
    }

    pendingDefaults = fetch(strmAssistantUrl)
      .then((response) => readJsonResponse<StrmAssistantDefaults>(response))
      .then(cacheDefaults)
      .finally(() => {
        pendingDefaults = null
      })

    return pendingDefaults
  },
  async setPluginDirectory(pluginDirectory) {
    const response = await fetch(`${strmAssistantUrl}/directory`, {
      body: JSON.stringify({ pluginDirectory }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    })

    return cacheDefaults(await readJsonResponse<StrmAssistantDefaults>(response))
  },
  async setTaskSchedule(schedule) {
    const response = await fetch(`${strmAssistantUrl}/task-schedule`, {
      body: JSON.stringify(schedule),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    })

    return cacheDefaults(await readJsonResponse<StrmAssistantDefaults>(response))
  },
  async getTaskRun(taskId) {
    const response = await fetch(`${strmAssistantUrl}/task-runs/${encodeURIComponent(taskId)}`)
    const result = await readJsonResponse<StrmAssistantTaskRunResult>(response)

    cacheStatus(result.status)

    return result
  },
  async runTaskOnce(taskId) {
    const response = await fetch(`${strmAssistantUrl}/task-runs/${encodeURIComponent(taskId)}`, {
      method: 'POST',
    })
    const result = await readJsonResponse<StrmAssistantTaskRunResult>(response)

    cacheStatus(result.status)

    return result
  },
  async start() {
    const response = await fetch(`${strmAssistantUrl}/start`, {
      method: 'POST',
    })

    const result = await readJsonResponse<StrmAssistantStartResult>(response)

    cacheStatus({
      ...result,
      sourceExists: result.sourceExists ?? true,
    })

    return result
  },
}
