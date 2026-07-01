import { useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'

import { AuthContext } from './authContext'
import type { AuthContextValue } from './authContext'
import { authService } from './authService'
import type { AuthSession } from './authService'

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(() => authService.getSession())

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: Boolean(session),
      session,
      login(credentials) {
        const nextSession = authService.login(credentials)
        setSession(nextSession)
        return nextSession
      },
      logout() {
        authService.logout()
        setSession(null)
      },
      updateCredentials(values) {
        const nextSession = authService.updateCredentials(values)
        setSession(nextSession)
        return nextSession
      },
    }),
    [session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
