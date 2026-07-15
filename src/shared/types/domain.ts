export type TaskStatus = 'idle' | 'running' | 'failed' | 'partial' | 'succeeded'
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
  aiRenameBeforeStrm: boolean
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
  partial?: boolean
  status?: TaskStatus
  cleanupDeleted?: number
  cleanupFailed?: number
  cleanupMissing?: number
  cleanupRemovedDirectories?: number
  cleanupShared?: number
  cleanupSkipped?: boolean
  aiRenameStatus?: 'completed' | 'partial' | 'failed' | 'cancelled' | 'skipped'
  aiRenameSucceeded?: number
  aiRenameSkipped?: number
  aiRenameFailed?: number
  aiRenameInventoryGroups?: number
  aiRenameSubmittedGroups?: number
  aiRenameUnchangedGroups?: number
  scannedDirectories: number
  mediaFiles: number
  generated: number
  skipped: number
  failed: number
  failedDirectories: number
  scanLimitReached?: boolean
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
  alist115?: {
    endpoint?: string
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

export interface AiRenameSettings {
  apiKeyConfigured: boolean
  baseUrl: string
  customParameters: string
  model: string
  namingStyle: AiRenameNamingStyle
  promptTemplate: string
  rebuildFolders: boolean
  tmdbBaseUrl: string
  tmdbEnabled: boolean
  tmdbLanguage: string
  tmdbTokenConfigured: boolean
}

export interface AiRenameSettingsUpdate {
  apiKey?: string
  baseUrl: string
  clearApiKey?: boolean
  clearTmdbToken?: boolean
  customParameters: string
  model: string
  namingStyle: AiRenameNamingStyle
  promptTemplate: string
  rebuildFolders: boolean
  tmdbBaseUrl: string
  tmdbEnabled: boolean
  tmdbLanguage: string
  tmdbToken?: string
}

export type AiRenameNamingStyle = 'zh-en' | 'en-zh' | 'zh' | 'en'

export type AiRenameJobStatus =
  'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'

export type AiRenameJobStage =
  'queued' | 'scanning' | 'analyzing' | 'executing' | 'moving' | 'finished' | 'failed' | 'cancelled'

export interface AiRenameJobProgress {
  analyzed: number
  completedOperations: number
  failed: number
  ignored: number
  inventoryGroups?: number
  processedGroups?: number
  scanned: number
  skipped: number
  succeeded: number
  totalGroups?: number
  totalOperations: number
  unchangedGroups?: number
}

export interface AiRenameJobResultItem {
  action: string
  at: string
  message: string
  newPath?: string
  oldPath?: string
  status: 'succeeded' | 'skipped' | 'failed' | 'ignored' | 'warning' | 'info'
}

export interface AiRenameJob {
  allowMove: boolean
  createdAt: string
  currentPath: string
  finishedAt?: string
  id: string
  message: string
  path: string
  progress: AiRenameJobProgress
  results: AiRenameJobResultItem[]
  stage: AiRenameJobStage
  startedAt?: string
  status: AiRenameJobStatus
  storageId: string
  taskId?: string
  useTmdb: boolean
}

export type AiRenameManagedTaskStatus =
  'idle' | 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'

export interface AiRenameManagedTask {
  allowMove: boolean
  createdAt: string
  currentJobId?: string
  extraPrompt?: string
  id: string
  lastJob?: AiRenameJob
  lastRunAt?: string
  name: string
  path: string
  status: AiRenameManagedTaskStatus
  storageId: string
  updatedAt: string
  useTmdb: boolean
}

export interface AiRenameManagedTaskInput {
  allowMove: boolean
  extraPrompt?: string
  id: string
  name: string
  path: string
  storageId: string
  useTmdb: boolean
}

export interface CreateAiRenameJobInput {
  allowMove: boolean
  extraPrompt?: string
  path: string
  recursive: true
  storageId: string
  useTmdb: boolean
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

export type StrmAssistantPluginSettingValue = boolean | number

export interface StrmAssistantPluginSettings {
  configFile?: string
  pluginId?: string
  pluginName?: string
  pluginVersion?: string
  source: string
  syncError?: string
  updatedAt?: string
  values: Record<string, StrmAssistantPluginSettingValue>
  writeWarning?: string
}

export type StrmAssistantTaskScheduleMode = 'hourly' | 'after-strm'
export type StrmAssistantTaskRunStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'

export interface StrmAssistantTaskSchedule {
  embyScheduleEnabled?: boolean
  embyTaskId?: string
  embyTaskName?: string
  embyTaskState?: string
  embyTriggerCount?: number
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
  hasExistingPluginFile?: boolean
  installed: boolean
  pluginFileName: string
  pluginSettings?: StrmAssistantPluginSettings
  replacementRequired?: boolean
  sourceExists: boolean
  taskSyncError?: string
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
  threadCount: number
  previewUrl: string
}

export interface ApiAccessSettings {
  createdAt: string
  enabled: boolean
  key: string
  updatedAt: string
}

export interface Proxy302Settings {
  apiSecret?: string
  configPath?: string
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

export interface EmbySettings {
  apiKey: string
}

export interface WebhookSettings {
  url: string
  embyDeleteSync: boolean
}
