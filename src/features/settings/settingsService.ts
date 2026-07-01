import { getApiBaseUrl } from '../../shared/config/runtimeConfig'
import type { Proxy302Settings, StrmSettings, WebhookSettings } from '../../shared/types/domain'

export interface AppSettings {
  strm: StrmSettings
  proxy302: Proxy302Settings
  webhook: WebhookSettings
}

export interface SettingsService {
  getProgramBaseUrl(): string
  getStrmSettings(): StrmSettings
  getProxy302Settings(): Proxy302Settings
  getWebhookSettings(): WebhookSettings
  loadSettings(): Promise<AppSettings>
  saveStrmSettings(settings: StrmSettings): Promise<StrmSettings>
  saveProxy302Settings(settings: Proxy302Settings): Promise<Proxy302Settings>
  saveWebhookSettings(settings: WebhookSettings): Promise<WebhookSettings>
  createStrmPreview(settings: StrmSettings): string
  createWebhookUrl(currentUrl?: string): string
  createSignSecret(): string
}

const backendBaseUrl = getApiBaseUrl()
const settingsUrl = `${backendBaseUrl}/api/settings`
const defaultOutputRoot = '/opt/openstrmbridge/strm'

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
    previewUrl: '',
  }
}

function getDefaultProxy302Settings(): Proxy302Settings {
  return {
    embyApiKey: '',
    engine: 'go-emby2openlist',
    enabled: true,
    healthy: true,
    mediaServerUrl: '',
    mountPath: '/media/strm',
    runtimeStatus: 'stopped',
    servicePort: 8097,
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

async function putSettingsSection<T>(section: string, values: T) {
  const response = await fetch(`${settingsUrl}/${section}`, {
    body: JSON.stringify(values),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PUT',
  })

  return readJsonResponse<T>(response)
}

export const settingsService: SettingsService = {
  getProgramBaseUrl,
  getStrmSettings() {
    return normalizeStrmSettings()
  },
  getProxy302Settings() {
    return getDefaultProxy302Settings()
  },
  getWebhookSettings() {
    return normalizeWebhookSettings()
  },
  async loadSettings() {
    if (import.meta.env.MODE === 'test') {
      return {
        proxy302: getDefaultProxy302Settings(),
        strm: normalizeStrmSettings(),
        webhook: normalizeWebhookSettings(),
      }
    }

    const response = await fetch(settingsUrl)
    const settings = await readJsonResponse<AppSettings>(response)

    return {
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
  async saveProxy302Settings(settings) {
    if (import.meta.env.MODE === 'test') {
      return settings
    }

    return putSettingsSection('proxy302', settings)
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
