import type { ReactNode } from 'react'

export type AppIconName =
  | 'tasks'
  | 'storage'
  | 'browser'
  | 'plugins'
  | 'settings'
  | 'arrowUp'
  | 'play'
  | 'stop'
  | 'edit'
  | 'copy'
  | 'delete'
  | 'link'
  | 'refresh'
  | 'menu'
  | 'login'
  | 'logout'
  | 'lock'
  | 'server'
  | 'file'
  | 'folder'
  | 'logs'
  | 'plug'
  | 'search'
  | 'external'
  | 'shield'
  | 'bot'
  | 'plus'
  | 'info'
  | 'activity'
  | 'alert'
  | 'calendar'
  | 'check'
  | 'database'
  | 'gauge'
  | 'sparkles'
  | 'user'

export type SettingsTabKey = 'strm' | 'proxy302' | 'emby' | 'webhook' | 'account' | 'about'

export interface NavItem {
  key: string
  label: string
  path: string
  icon: AppIconName
}

export interface ActionButtonConfig {
  label: string
  icon: AppIconName
  tone?: 'primary' | 'muted' | 'success' | 'danger' | 'cyan'
  disabled?: boolean
  onClick: () => void
}

export interface PageAction {
  key: string
  label: string
  icon?: ReactNode
  onClick: () => void
}
