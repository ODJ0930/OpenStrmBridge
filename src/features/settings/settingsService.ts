import { getApiBaseUrl } from '../../shared/config/runtimeConfig'
import type {
  AiRenameSettings,
  AiRenameSettingsUpdate,
  EmbySettings,
  Proxy302Settings,
  StrmSettings,
  WebhookSettings,
} from '../../shared/types/domain'

export interface AppSettings {
  aiRename: AiRenameSettings
  strm: StrmSettings
  proxy302: Proxy302Settings
  emby: EmbySettings
  webhook: WebhookSettings
}

export interface AiRenameConnectionTestResult {
  completionTokens: number
  latencyMs: number
  message: string
  model: string
  ok: boolean
  tokenCountEstimated: boolean
  tokensPerSecond: number
}

export interface AiRenameTmdbTestResult {
  latencyMs: number
  message: string
  ok: boolean
}

export interface AiRenameModelDiscoveryResult {
  count: number
  message: string
  models: Array<{ id: string; ownedBy?: string }>
  ok: boolean
}

export interface SettingsService {
  discoverAiRenameModels(settings: AiRenameSettingsUpdate): Promise<AiRenameModelDiscoveryResult>
  getAiRenameSettings(): AiRenameSettings
  getProgramBaseUrl(): string
  getStrmSettings(): StrmSettings
  getProxy302Settings(): Proxy302Settings
  getEmbySettings(): EmbySettings
  getWebhookSettings(): WebhookSettings
  loadSettings(): Promise<AppSettings>
  saveStrmSettings(settings: StrmSettings): Promise<StrmSettings>
  saveAiRenameSettings(settings: AiRenameSettingsUpdate): Promise<AiRenameSettings>
  testAiRenameSettings(settings: AiRenameSettingsUpdate): Promise<AiRenameConnectionTestResult>
  testAiRenameTmdb(settings: AiRenameSettingsUpdate): Promise<AiRenameTmdbTestResult>
  saveProxy302Settings(settings: Proxy302Settings): Promise<Proxy302Settings>
  saveEmbySettings(settings: EmbySettings): Promise<EmbySettings>
  saveWebhookSettings(settings: WebhookSettings): Promise<WebhookSettings>
  createStrmPreview(settings: StrmSettings): string
  createWebhookUrl(currentUrl?: string): string
  createSignSecret(): string
}

type LegacyProxy302Settings = Proxy302Settings & {
  embyApiKey?: string
  mediaServerToken?: string
}

const backendBaseUrl = getApiBaseUrl()
const settingsUrl = `${backendBaseUrl}/api/settings`
const defaultOutputRoot = '/opt/openstrmbridge/strm'
const defaultThreadCount = 1

function getProgramBaseUrl() {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.location.origin
}

function createSignSecret() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues(bytes)

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

function createWebhookUrl(currentUrl?: string) {
  const token = createSignSecret()
  const fallbackUrl = `${backendBaseUrl}/webhook/${token}`
  const rawUrl = String(currentUrl ?? '').trim()

  if (!rawUrl) {
    return fallbackUrl
  }

  try {
    const url = new URL(rawUrl)
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const webhookIndex = pathSegments.lastIndexOf('webhook')

    if (webhookIndex >= 0) {
      url.pathname = `/${[...pathSegments.slice(0, webhookIndex + 1), token].join('/')}`
    } else {
      const basePath = url.pathname.replace(/\/+$/, '')
      url.pathname = `${basePath}/webhook/${token}`.replace(/^\/?/, '/')
    }

    url.search = ''
    url.hash = ''

    return url.toString()
  } catch {
    return fallbackUrl
  }
}

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function normalizeOutputRoot(outputRoot: string | undefined) {
  const normalized = (outputRoot || defaultOutputRoot)
    .trim()
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')

  if (!normalized) {
    return defaultOutputRoot
  }

  return normalized
}

function normalizeThreadCount(threadCount: number | string | undefined) {
  const parsed = Number.parseInt(String(threadCount ?? ''), 10)

  if (!Number.isFinite(parsed)) {
    return defaultThreadCount
  }

  return Math.max(1, Math.min(64, parsed))
}

function getDefaultStrmSettings(): StrmSettings {
  const baseUrl = getProgramBaseUrl()

  return {
    mediaExtensions: 'mp4,mkv,mov,avi,flv,m4v,ts,mp3,m4a,ogg,wav,aac,flac',
    minMediaSizeMb: 2,
    sidecarExtensions: 'nfo,jpg,png,ass,srt',
    outputRoot: defaultOutputRoot,
    baseUrl,
    encodeUrl: true,
    cloudNamingMode: '文件编号模式',
    signEnabled: true,
    signSecret: createSignSecret(),
    threadCount: defaultThreadCount,
    previewUrl: '',
  }
}

function getDefaultAiRenameSettings(): AiRenameSettings {
  return {
    apiKeyConfigured: false,
    baseUrl: 'https://api.openai.com/v1',
    customParameters: '{}',
    model: '',
    namingStyle: 'zh-en',
    promptTemplate: [
      '你是电视剧媒体库命名分析器。请仅依据现有目录名和文件名识别剧集信息。',
      '识别正式中文名、英文或原始标题、首播年份、季号、集号、多集编号、版本号和分段标记。',
      '目录季号与文件季号冲突时，以多数视频文件中可验证的季集信息为准。',
      '广告图片、网站宣传文件、发布组与画质编码信息应忽略；无法可靠识别的条目不要猜测。',
      '字幕、NFO、海报等附属文件只在能可靠关联视频时标记。',
    ].join('\n'),
    rebuildFolders: false,
    tmdbBaseUrl: 'https://api.themoviedb.org/3',
    tmdbEnabled: false,
    tmdbLanguage: 'zh-CN',
    tmdbTokenConfigured: false,
  }
}

function normalizeAiRenameSettings(
  settings: Partial<AiRenameSettings> | undefined,
): AiRenameSettings {
  return {
    ...getDefaultAiRenameSettings(),
    ...settings,
  }
}

function getDefaultProxy302Settings(): Proxy302Settings {
  return {
    engine: 'go-emby2openlist',
    enabled: false,
    healthy: true,
    mediaServerUrl: '',
    mountPath: '/media/strm',
    runtimeStatus: 'stopped',
    servicePort: 8097,
  }
}

function getDefaultEmbySettings(): EmbySettings {
  return {
    apiKey: '',
  }
}

function getDefaultWebhookSettings(): WebhookSettings {
  const url = createWebhookUrl()

  return {
    url,
    embyDeleteSync: true,
  }
}

function normalizeStrmSettings(settings: Partial<StrmSettings> = {}): StrmSettings {
  const defaults = getDefaultStrmSettings()
  const normalizedSettings = {
    ...defaults,
    ...settings,
    baseUrl: settings.baseUrl || getProgramBaseUrl() || defaults.baseUrl,
    outputRoot: normalizeOutputRoot(settings.outputRoot || defaults.outputRoot),
    threadCount: normalizeThreadCount(settings.threadCount ?? defaults.threadCount),
  }

  return {
    ...normalizedSettings,
    previewUrl: createStrmPreview(normalizedSettings),
  }
}

function normalizeWebhookSettings(settings: Partial<WebhookSettings> = {}): WebhookSettings {
  const defaults = getDefaultWebhookSettings()
  const webhookSettings = {
    ...defaults,
    ...settings,
  }

  if (!webhookSettings.url) {
    webhookSettings.url = createWebhookUrl()
  }

  return webhookSettings
}

function createStrmPreview(settings: StrmSettings) {
  const baseUrl = trimTrailingSlash(settings.baseUrl || getProgramBaseUrl())
  const samplePath = settings.encodeUrl ? encodeURIComponent('/path/movie.mp4') : '/path/movie.mp4'
  const sign = settings.signEnabled ? `?sign=${settings.signSecret || 'SIGN_SECRET'}` : ''

  return baseUrl ? `${baseUrl}/smartstrm/path${samplePath}${sign}` : ''
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

async function putSettingsSection<TResponse, TRequest = TResponse>(
  section: string,
  values: TRequest,
) {
  const response = await fetch(`${settingsUrl}/${section}`, {
    body: JSON.stringify(values),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PUT',
  })

  return readJsonResponse<TResponse>(response)
}

export const settingsService: SettingsService = {
  async discoverAiRenameModels(settings) {
    if (import.meta.env.MODE === 'test') {
      return {
        count: 2,
        message: '已探测到 2 个模型',
        models: [
          { id: 'gpt-4.1-mini', ownedBy: 'openai' },
          { id: 'test-model', ownedBy: 'test' },
        ],
        ok: true,
      }
    }

    const response = await fetch(`${backendBaseUrl}/api/ai-rename/models`, {
      body: JSON.stringify(settings),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    return readJsonResponse<AiRenameModelDiscoveryResult>(response)
  },
  getProgramBaseUrl,
  getAiRenameSettings() {
    return getDefaultAiRenameSettings()
  },
  getStrmSettings() {
    return normalizeStrmSettings()
  },
  getProxy302Settings() {
    return getDefaultProxy302Settings()
  },
  getEmbySettings() {
    return getDefaultEmbySettings()
  },
  getWebhookSettings() {
    return normalizeWebhookSettings()
  },
  async loadSettings() {
    if (import.meta.env.MODE === 'test') {
      return {
        aiRename: getDefaultAiRenameSettings(),
        emby: getDefaultEmbySettings(),
        proxy302: getDefaultProxy302Settings(),
        strm: normalizeStrmSettings(),
        webhook: normalizeWebhookSettings(),
      }
    }

    const response = await fetch(settingsUrl)
    const settings = await readJsonResponse<AppSettings>(response)
    const legacyProxy302Settings = settings.proxy302 as LegacyProxy302Settings

    return {
      aiRename: normalizeAiRenameSettings(settings.aiRename),
      emby: {
        ...getDefaultEmbySettings(),
        ...settings.emby,
        apiKey:
          settings.emby?.apiKey ||
          legacyProxy302Settings.embyApiKey ||
          legacyProxy302Settings.mediaServerToken ||
          '',
      },
      proxy302: {
        ...getDefaultProxy302Settings(),
        ...settings.proxy302,
      },
      strm: normalizeStrmSettings(settings.strm),
      webhook: normalizeWebhookSettings(settings.webhook),
    }
  },
  async saveStrmSettings(settings) {
    const normalizedSettings = normalizeStrmSettings(settings)

    if (import.meta.env.MODE === 'test') {
      return normalizedSettings
    }

    return normalizeStrmSettings(await putSettingsSection('strm', normalizedSettings))
  },
  async saveAiRenameSettings(settings) {
    if (import.meta.env.MODE === 'test') {
      return {
        ...normalizeAiRenameSettings(settings),
        apiKeyConfigured: Boolean(settings.apiKey),
        tmdbTokenConfigured: Boolean(settings.tmdbToken),
      }
    }

    return putSettingsSection<AiRenameSettings, AiRenameSettingsUpdate>('ai-rename', settings)
  },
  async testAiRenameSettings(settings) {
    if (import.meta.env.MODE === 'test') {
      return {
        completionTokens: 24,
        latencyMs: 320,
        message: 'AI 模型可用性测试通过',
        model: settings.model,
        ok: true,
        tokenCountEstimated: false,
        tokensPerSecond: 75,
      }
    }

    const response = await fetch(`${backendBaseUrl}/api/ai-rename/test`, {
      body: JSON.stringify(settings),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    return readJsonResponse<AiRenameConnectionTestResult>(response)
  },
  async testAiRenameTmdb(settings) {
    if (import.meta.env.MODE === 'test') {
      return {
        latencyMs: 95,
        message: 'TMDB 连接测试通过',
        ok: true,
      }
    }

    const response = await fetch(`${backendBaseUrl}/api/ai-rename/tmdb/test`, {
      body: JSON.stringify(settings),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    return readJsonResponse<AiRenameTmdbTestResult>(response)
  },
  async saveProxy302Settings(settings) {
    if (import.meta.env.MODE === 'test') {
      return settings
    }

    return putSettingsSection('proxy302', settings)
  },
  async saveEmbySettings(settings) {
    if (import.meta.env.MODE === 'test') {
      return settings
    }

    return putSettingsSection('emby', settings)
  },
  async saveWebhookSettings(settings) {
    const normalizedSettings = normalizeWebhookSettings(settings)

    if (import.meta.env.MODE === 'test') {
      return normalizedSettings
    }

    return normalizeWebhookSettings(await putSettingsSection('webhook', normalizedSettings))
  },
  createStrmPreview,
  createWebhookUrl,
  createSignSecret,
}
