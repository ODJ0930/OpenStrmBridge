export interface RuntimeAuthConfig {
  password?: string
  revision?: string
  username?: string
}

export interface OpenStrmBridgeRuntimeConfig {
  apiBaseUrl?: string
  auth?: RuntimeAuthConfig
}

declare global {
  interface Window {
    __OPENSTRMBRIDGE_RUNTIME_CONFIG__?: OpenStrmBridgeRuntimeConfig
  }
}

function getWindowRuntimeConfig(): OpenStrmBridgeRuntimeConfig {
  if (typeof window === 'undefined') {
    return {}
  }

  return window.__OPENSTRMBRIDGE_RUNTIME_CONFIG__ ?? {}
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export function getApiBaseUrl() {
  const runtimeApiBaseUrl = getWindowRuntimeConfig().apiBaseUrl?.trim()
  const buildApiBaseUrl = import.meta.env.VITE_OPENSTRMBRIDGE_API_BASE_URL?.trim()

  if (runtimeApiBaseUrl) {
    return trimTrailingSlash(runtimeApiBaseUrl)
  }

  if (buildApiBaseUrl) {
    return trimTrailingSlash(buildApiBaseUrl)
  }

  return import.meta.env.DEV ? 'http://127.0.0.1:5174' : ''
}

export function getRuntimeAuthConfig():
  | (Required<Pick<RuntimeAuthConfig, 'password' | 'username'>> &
      Pick<RuntimeAuthConfig, 'revision'>)
  | null {
  const auth = getWindowRuntimeConfig().auth
  const username = auth?.username?.trim()

  if (!username || auth?.password === undefined) {
    return null
  }

  return {
    password: String(auth.password),
    revision: auth.revision?.trim() || undefined,
    username,
  }
}
