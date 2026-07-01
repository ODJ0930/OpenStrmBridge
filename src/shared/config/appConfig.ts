import type { NavItem, SettingsTabKey } from '../types/ui'

export const brandConfig = {
  name: 'OpenStrmBridge',
  shortName: 'OSB',
  version: 'v0.1.2',
  repositoryLabel: 'OpenStrmBridge',
} as const

export const routes = {
  tasks: { path: '/tasks', label: '任务管理', icon: 'tasks' },
  storage: { path: '/storage', label: '存储管理', icon: 'storage' },
  browser: { path: '/browser', label: '存储浏览', icon: 'browser' },
  plugins: { path: '/plugins', label: '神医助手', icon: 'plugins' },
  settings: { path: '/settings', label: '系统设置', icon: 'settings' },
} as const

export const navItems: NavItem[] = Object.entries(routes).map(([key, route]) => ({
  key,
  label: route.label,
  path: route.path,
  icon: route.icon,
}))

export const systemTabs: Array<{ key: SettingsTabKey; label: string }> = [
  { key: 'strm', label: 'STRM 设置' },
  { key: 'proxy302', label: '302代理' },
  { key: 'emby', label: 'Emby 授权' },
  { key: 'webhook', label: 'Webhook' },
  { key: 'account', label: '账号安全' },
  { key: 'about', label: '关于' },
]
