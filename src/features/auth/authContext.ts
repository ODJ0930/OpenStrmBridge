import { createContext, useContext } from 'react'

import type { AuthSession, LoginCredentials, UpdateCredentialsValues } from './authService'

export interface AuthContextValue {
  isAuthenticated: boolean
  session: AuthSession | null
  login(credentials: LoginCredentials): AuthSession
  logout(): void
  updateCredentials(values: UpdateCredentialsValues): AuthSession | null
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return context
}
