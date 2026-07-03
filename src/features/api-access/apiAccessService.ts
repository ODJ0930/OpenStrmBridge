import { getApiBaseUrl } from '../../shared/config/runtimeConfig'
import type { ApiAccessSettings } from '../../shared/types/domain'

export interface ApiAccessService {
  getEndpointBaseUrl(): string
  getAccess(): Promise<ApiAccessSettings>
  update(values: Pick<ApiAccessSettings, 'enabled'>): Promise<ApiAccessSettings>
  regenerate(): Promise<ApiAccessSettings>
}

const backendBaseUrl = getApiBaseUrl()
const accessUrl = `${backendBaseUrl}/api/access`

function getEndpointBaseUrl() {
  if (backendBaseUrl) {
    return backendBaseUrl
  }

  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  return ''
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

function createDefaultAccess(): ApiAccessSettings {
  return {
    createdAt: new Date().toISOString(),
    enabled: true,
    key: 'osb_development_api_key',
    updatedAt: new Date().toISOString(),
  }
}

export const apiAccessService: ApiAccessService = {
  getEndpointBaseUrl,
  async getAccess() {
    if (import.meta.env.MODE === 'test') {
      return createDefaultAccess()
    }

    const response = await fetch(accessUrl)
    return readJsonResponse<ApiAccessSettings>(response)
  },
  async update(values) {
    if (import.meta.env.MODE === 'test') {
      return {
        ...createDefaultAccess(),
        ...values,
      }
    }

    const response = await fetch(accessUrl, {
      body: JSON.stringify(values),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    })

    return readJsonResponse<ApiAccessSettings>(response)
  },
  async regenerate() {
    if (import.meta.env.MODE === 'test') {
      return {
        ...createDefaultAccess(),
        key: 'osb_regenerated_api_key',
      }
    }

    const response = await fetch(`${accessUrl}/regenerate`, {
      method: 'POST',
    })

    return readJsonResponse<ApiAccessSettings>(response)
  },
}
