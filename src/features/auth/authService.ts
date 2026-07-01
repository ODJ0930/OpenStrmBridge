import { getRuntimeAuthConfig } from '../../shared/config/runtimeConfig'

export interface LoginCredentials {
  username: string
  password: string
  remember?: boolean
}

export interface AuthSession {
  username: string
  signedInAt: string
}

export interface AuthAccountSettings {
  username: string
}

export interface UpdateCredentialsValues {
  currentPassword: string
  username: string
  password: string
}

const persistentSessionKey = 'openstrmbridge.auth.session'
const temporarySessionKey = 'openstrmbridge.auth.temporary-session'
const credentialsKey = 'openstrmbridge.auth.credentials'
const credentialsRevisionKey = 'openstrmbridge.auth.credentials-revision'
const defaultUsername = import.meta.env.VITE_OPENSTRMBRIDGE_LOGIN_USER ?? 'admin'
const defaultPassword = import.meta.env.VITE_OPENSTRMBRIDGE_LOGIN_PASSWORD ?? 'openstrmbridge'

interface AuthCredentials {
  username: string
  password: string
}

interface StoredSession {
  key: string
  session: AuthSession
  storage: Storage
}

function getStorage(kind: 'local' | 'session') {
  if (typeof window === 'undefined') {
    return undefined
  }

  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return undefined
  }
}

function readStoredSession(storage: Storage | undefined, key: string): AuthSession | null {
  if (!storage) {
    return null
  }

  try {
    const rawSession = storage.getItem(key)

    if (!rawSession) {
      return null
    }

    const session = JSON.parse(rawSession) as Partial<AuthSession>

    if (!session.username || !session.signedInAt) {
      return null
    }

    return {
      username: String(session.username),
      signedInAt: String(session.signedInAt),
    }
  } catch {
    return null
  }
}

function readCurrentStoredSession(): StoredSession | null {
  const localStorage = getStorage('local')
  const persistentSession = readStoredSession(localStorage, persistentSessionKey)

  if (localStorage && persistentSession) {
    return {
      key: persistentSessionKey,
      session: persistentSession,
      storage: localStorage,
    }
  }

  const sessionStorage = getStorage('session')
  const temporarySession = readStoredSession(sessionStorage, temporarySessionKey)

  if (sessionStorage && temporarySession) {
    return {
      key: temporarySessionKey,
      session: temporarySession,
      storage: sessionStorage,
    }
  }

  return null
}

function readStoredCredentials(): AuthCredentials | null {
  const storage = getStorage('local')

  if (!storage) {
    return null
  }

  try {
    const rawCredentials = storage.getItem(credentialsKey)

    if (!rawCredentials) {
      return null
    }

    const credentials = JSON.parse(rawCredentials) as Partial<AuthCredentials>

    if (!credentials.username || !credentials.password) {
      return null
    }

    return {
      password: String(credentials.password),
      username: String(credentials.username),
    }
  } catch {
    return null
  }
}

function syncRuntimeCredentials() {
  const storage = getStorage('local')
  const runtimeCredentials = getRuntimeAuthConfig()
  const runtimeRevision = runtimeCredentials?.revision

  if (!storage || !runtimeCredentials || !runtimeRevision) {
    return
  }

  if (storage.getItem(credentialsRevisionKey) === runtimeRevision) {
    return
  }

  storage.setItem(
    credentialsKey,
    JSON.stringify({
      password: runtimeCredentials.password,
      username: runtimeCredentials.username,
    }),
  )
  storage.setItem(credentialsRevisionKey, runtimeRevision)
  clearSession()
}

function getCredentials(): AuthCredentials {
  syncRuntimeCredentials()

  return (
    readStoredCredentials() ??
    getRuntimeAuthConfig() ?? {
      password: defaultPassword,
      username: defaultUsername,
    }
  )
}

function writeSession(session: AuthSession, remember: boolean) {
  clearSession()

  const storage = getStorage(remember ? 'local' : 'session')
  const key = remember ? persistentSessionKey : temporarySessionKey

  storage?.setItem(key, JSON.stringify(session))
}

function clearSession() {
  getStorage('local')?.removeItem(persistentSessionKey)
  getStorage('session')?.removeItem(temporarySessionKey)
}

function validateCredentials({ password, username }: LoginCredentials) {
  const credentials = getCredentials()

  return username.trim() === credentials.username && password === credentials.password
}

function updateStoredSessionUsername(username: string) {
  const storedSession = readCurrentStoredSession()

  if (!storedSession) {
    return null
  }

  const nextSession: AuthSession = {
    ...storedSession.session,
    username,
  }

  storedSession.storage.setItem(storedSession.key, JSON.stringify(nextSession))

  return nextSession
}

export const authService = {
  getSession() {
    return readCurrentStoredSession()?.session ?? null
  },
  getAccountSettings(): AuthAccountSettings {
    return {
      username: getCredentials().username,
    }
  },
  login(credentials: LoginCredentials) {
    if (!validateCredentials(credentials)) {
      throw new Error('账号或密码不正确')
    }

    const session: AuthSession = {
      username: credentials.username.trim(),
      signedInAt: new Date().toISOString(),
    }

    writeSession(session, credentials.remember ?? true)
    return session
  },
  updateCredentials(values: UpdateCredentialsValues) {
    const credentials = getCredentials()
    const username = values.username.trim()
    const password = values.password

    if (values.currentPassword !== credentials.password) {
      throw new Error('当前密码不正确')
    }

    if (!username) {
      throw new Error('请输入账号')
    }

    if (!password) {
      throw new Error('请输入新密码')
    }

    const storage = getStorage('local')
    const runtimeRevision = getRuntimeAuthConfig()?.revision

    storage?.setItem(
      credentialsKey,
      JSON.stringify({
        password,
        username,
      }),
    )

    if (runtimeRevision) {
      storage?.setItem(credentialsRevisionKey, runtimeRevision)
    }

    return updateStoredSessionUsername(username)
  },
  logout() {
    clearSession()
  },
}
