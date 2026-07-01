export type TaskStatus = 'idle' | 'running' | 'failed'
export type StorageAccessMethod = 'openlist' | 'webdav' | 'local'
export type StorageStatus = 'connected' | 'unchecked' | 'failed'
export type FileEntryKind = 'folder' | 'file'

export interface TaskItem {
  id: string
  name: string
  storage: string
  storageId: string
  path: string
  schedule: string
  nextRun: string
  status: TaskStatus
  directoryTimeCheck: boolean
  incremental: boolean
  preRefreshOpenListCache: boolean
  outputPath: string
  lastRunAt?: string
  lastResult?: TaskRunResult
  lastLog?: string
}

export interface TaskRunResult {
  ok: boolean
  scannedDirectories: number
  mediaFiles: number
  generated: number
  skipped: number
  failed: number
  failedDirectories: number
  outputPath: string
  startedAt: string
  finishedAt: string
}

export interface TaskLogResult {
  taskId: string
  taskName: string
  log: string
  status: TaskStatus
  updatedAt?: string
}

export interface StorageItem {
  id: string
  name: string
  accessMethod: StorageAccessMethod
  endpoint: string
  rootPath: string
  status: StorageStatus
  quotaText?: string
  usagePercent?: number
  badge?: string
  credentialLabel?: string
  lastCheck?: StorageConnectionCheckResult
  openlist?: {
    username?: string
    basePath: string
    strmBaseUrl?: string
    enableUrlEncoding: boolean
    token?: string
  }
  webdav?: {
    username?: string
    password?: string
  }
  local?: {
    path: string
  }
}

export interface StorageDiscoveredEntry {
  id: string
  name: string
  path: string
  kind: FileEntryKind
  size?: number
  updatedAt?: string
}

export interface StorageConnectionCheckResult {
  storageId: string
  method: StorageAccessMethod
  checkedAt: string
  ok: boolean
  title: string
  message: string
  endpoint: string
  rootPath: string
  folders: StorageDiscoveredEntry[]
  files: StorageDiscoveredEntry[]
  username?: string
  basePath?: string
  requiresBackend?: boolean
}

export interface FileEntry {
  id: string
  name: string
  path: string
  kind: FileEntryKind
  size: string
  updatedAt: string
}

export interface StrmAssistantValues {
  containerPluginDirectory: string
  sourceFile: string
  pluginDirectory: string
  embyContainerName: string
}

export type StrmAssistantCapabilityKind = 'api' | 'feature' | 'option' | 'task'

export interface StrmAssistantCapabilityItem {
  detected: boolean
  entry: string
  id: string
  kind: StrmAssistantCapabilityKind
  label: string
  mutable: boolean
}

export interface StrmAssistantCapabilities {
  apiItems: StrmAssistantCapabilityItem[]
  controlItems: StrmAssistantCapabilityItem[]
  editable: boolean
  features: StrmAssistantCapabilityItem[]
  pluginVersion: string
  source: string
}

export type StrmAssistantTaskScheduleMode = 'hourly' | 'after-strm'
export type StrmAssistantTaskRunStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'

export interface StrmAssistantTaskSchedule {
  embyTaskId?: string
  embyTaskName?: string
  embyTaskState?: string
  enabled: boolean
  intervalHours: number
  lastError?: string
  lastFinishedAt?: string
  lastSourceTaskFinishedAt?: string
  lastSourceTaskId?: string
  lastSourceTaskName?: string
  lastTriggeredAt?: string
  mode?: StrmAssistantTaskScheduleMode
  modes: StrmAssistantTaskScheduleMode[]
  runMessage?: string
  runProgress?: number
  runStatus?: StrmAssistantTaskRunStatus
  runUpdatedAt?: string
  taskId: string
  taskName: string
  updatedAt?: string
}

export interface StrmAssistantStatus extends StrmAssistantValues {
  capabilities: StrmAssistantCapabilities
  detectionSource: string
  foundPluginDirectory: boolean
  installed: boolean
  pluginFileName: string
  sourceExists: boolean
  taskSchedules: Record<string, StrmAssistantTaskSchedule>
  targetFile: string
}

export interface StrmAssistantStartResult extends StrmAssistantStatus {
  message: string
  restarted: boolean
  restartOutput: string
  size: number
  updatedAt: string
}

export interface StrmAssistantDefaults extends StrmAssistantValues {
  status: StrmAssistantStatus
}

export interface StrmAssistantTaskRunResult {
  schedule: StrmAssistantTaskSchedule
  status: StrmAssistantStatus
}

export interface StrmSettings {
  mediaExtensions: string
  minMediaSizeMb: number
  sidecarExtensions: string
  outputRoot: string
  baseUrl: string
  encodeUrl: boolean
  cloudNamingMode: string
  signEnabled: boolean
  signSecret: string
  previewUrl: string
}

export interface Proxy302Settings {
  apiSecret?: string
  configPath?: string
  embyApiKey?: string
  enabled: boolean
  engine?: 'go-emby2openlist'
  healthy: boolean
  logTail?: string
  mediaServerUrl: string
  mountPath: string
  openListStorageId?: string
  runtimeCommand?: string
  runtimeStatus?: 'running' | 'stopped' | 'failed' | string
  sourcePath?: string
  servicePort: number
}

export interface WebhookSettings {
  url: string
  embyDeleteSync: boolean
}
