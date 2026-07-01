import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = 5174
const port = Number.parseInt(process.env.OPENSTRMBRIDGE_BACKEND_PORT ?? '', 10) || DEFAULT_PORT
const host = process.env.OPENSTRMBRIDGE_BACKEND_HOST?.trim() || '127.0.0.1'
const dataDir = process.env.OPENSTRMBRIDGE_DATA_DIR ?? path.join(process.cwd(), 'data')
const webDir = process.env.OPENSTRMBRIDGE_WEB_DIR?.trim() || path.join(process.cwd(), 'dist')
const settingsFile = path.join(dataDir, 'settings.json')
const storagesFile = path.join(dataDir, 'storages.json')
const tasksFile = path.join(dataDir, 'tasks.json')
const strmIndexFile = path.join(dataDir, 'strm-index.json')
const runtimeConfigFile =
  process.env.OPENSTRMBRIDGE_RUNTIME_CONFIG_FILE?.trim() ||
  path.join(dataDir, 'runtime-config.json')
const ge2oDataDir = path.join(dataDir, 'go-emby2openlist')
const ge2oConfigFile = path.join(ge2oDataDir, 'config.yml')
const ge2oCustomCssDir = path.join(ge2oDataDir, 'custom-css')
const ge2oCustomJsDir = path.join(ge2oDataDir, 'custom-js')
const ge2oEmbyCleanupCssFile = path.join(ge2oCustomCssDir, 'openstrmbridge-emby-cleanup.css')
const ge2oEmbyCleanupJsFile = path.join(ge2oCustomJsDir, 'openstrmbridge-emby-cleanup.js')
const ge2oSourceDir =
  process.env.OPENSTRMBRIDGE_GE2O_SOURCE_DIR?.trim() ||
  path.join(process.cwd(), 'vendor', 'go-emby2openlist')
const packagedGe2oBinaryFile =
  process.env.OPENSTRMBRIDGE_GE2O_BINARY?.trim() ||
  path.join(process.cwd(), 'resources', 'bin', process.platform === 'win32' ? 'ge2o.exe' : 'ge2o')
const ge2oPublicBackendUrl =
  process.env.OPENSTRMBRIDGE_BACKEND_PUBLIC_URL?.trim() || `http://127.0.0.1:${port}`
const defaultOutputRoot =
  process.env.OPENSTRMBRIDGE_STRM_DIR?.trim() ||
  process.env.STRM_OUTPUT_ROOT?.trim() ||
  '/opt/openstrmbridge/strm'
const defaultEmbyMountPath = process.env.OPENSTRMBRIDGE_EMBY_MOUNT_PATH?.trim() || '/media/strm'
const bundledStrmAssistantPluginFile = path.join(
  process.cwd(),
  'resources',
  'emby-plugins',
  'StrmAssistantLite.dll',
)
const strmAssistantInstalledPluginFileName = 'StrmAssistant.dll'
const strmAssistantContainerPluginDirectory = '/config/plugins'
const configuredEmbyPluginDirectory = process.env.OPENSTRMBRIDGE_EMBY_PLUGIN_DIR?.trim()
const defaultEmbyContainerName =
  process.env.OPENSTRMBRIDGE_EMBY_CONTAINER_NAME?.trim() || 'openstrmbridge-emby'
const commonEmbyContainerNames = ['emby', 'embyserver', 'emby-server']

const strmAssistantFeatureLabels = {
  ChapterApi: '章节标记',
  FingerprintApi: '片头指纹',
  LibraryApi: '媒体库处理',
  MediaInfoApi: '媒体信息',
  MetadataApi: '元数据增强',
  NotificationApi: '通知推送',
  SubtitleApi: '外挂字幕',
  VideoThumbnailApi: '视频缩略图',
}

const strmAssistantOptionLabels = {
  AboutOptions: '关于信息',
  ExperienceEnhanceOptions: '体验增强',
  GeneralOptions: '通用设置',
  IntroSkipOptions: '片头跳过',
  MediaInfoExtractOptions: '媒体信息提取',
  MetadataEnhanceOptions: '元数据增强',
  ModOptions: '界面增强',
  NetworkOptions: '网络设置',
  PluginOptions: '插件总配置',
  TypeOptions: '类型设置',
  UIFunctionOptions: '界面功能',
}

const strmAssistantTaskLabels = {
  CheckMissingMediaInfoTask: '检查缺失媒体信息',
  ClearChapterMarkersTask: '清理章节标记',
  DeletePersonTask: '删除人物',
  ExtractIntroFingerprintTask: '提取片头指纹',
  ExtractMediaInfoTask: '提取媒体信息',
  ExtractStrmPrimaryImageTask: '提取 STRM 封面',
  ExtractVideoThumbnailTask: '提取视频缩略图',
  MergeMultiVersionTask: '合并多版本',
  PersistMediaInfoTask: '持久化媒体信息',
  RefreshEpisodeTask: '刷新剧集',
  RefreshPersonTask: '刷新人物',
  ScanExternalSubtitleTask: '扫描外挂字幕',
  UpdateCreditsTask: '更新演职员',
  UpdateIntroTask: '更新片头',
  UpdatePluginTask: '更新插件',
}

const strmAssistantTaskClassById = {
  'check-missing-media-info': 'CheckMissingMediaInfoTask',
  'clear-chapter-markers': 'ClearChapterMarkersTask',
  'extract-intro-fingerprint': 'ExtractIntroFingerprintTask',
  'extract-media-info': 'ExtractMediaInfoTask',
  'extract-strm-primary-image': 'ExtractStrmPrimaryImageTask',
  'extract-video-thumbnail': 'ExtractVideoThumbnailTask',
  'merge-version': 'MergeMultiVersionTask',
  'persist-media-info': 'PersistMediaInfoTask',
  'refresh-episode': 'RefreshEpisodeTask',
  'refresh-person': 'RefreshPersonTask',
  'scan-subtitle': 'ScanExternalSubtitleTask',
  'update-plugin': 'UpdatePluginTask',
}

const strmAssistantTaskTitlesById = {
  'check-missing-media-info': '检查补漏缺失媒体信息',
  'clear-chapter-markers': '清除片头片尾标记',
  'extract-intro-fingerprint': '提取片头声纹',
  'extract-media-info': '提取媒体信息',
  'extract-strm-primary-image': '获取strm视频封面',
  'extract-video-thumbnail': '提取视频缩略图',
  'merge-version': '合并多版本',
  'persist-media-info': '持久化媒体信息',
  'refresh-episode': '刷新剧集元数据',
  'refresh-person': '刷新演员信息',
  'scan-subtitle': '扫描外挂字幕',
  'update-plugin': '更新本插件',
}

const strmAssistantApiLabels = {
  GetShortcutMenu: '快捷菜单接口',
  GetStrmAssistantJs: '前端脚本接口',
  '/modules/common/globalize.js': '全局化脚本',
  '/modules/common/itemmanager/itemmanager.js': '项目管理脚本',
  '/strmassistant/strmassistant': '神医助手页面',
  'StrmAssistant.Web.Api': 'Web API 命名空间',
  'StrmAssistant.Web.Resources.shortcuts.js': '快捷菜单资源',
  'StrmAssistant.Web.Resources.strmassistant.js': '页面资源',
}

const defaultMediaExtensions = new Set([
  '.3gp',
  '.aac',
  '.avi',
  '.divx',
  '.flac',
  '.flv',
  '.iso',
  '.m2ts',
  '.m4a',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.ogg',
  '.rmvb',
  '.ts',
  '.wav',
  '.webm',
  '.wmv',
])

const scanLimits = {
  directories: 2000,
  mediaFiles: 5000,
}

const taskRuntimeLogs = new Map()
const configuredTaskSchedulerIntervalMs = Number.parseInt(
  process.env.OPENSTRMBRIDGE_TASK_SCHEDULER_INTERVAL_MS ?? '',
  10,
)
const taskSchedulerIntervalMs = Number.isFinite(configuredTaskSchedulerIntervalMs)
  ? configuredTaskSchedulerIntervalMs
  : 60_000
const scheduledTaskIds = new Set()
let taskSchedulerRunning = false
let taskSchedulerTimer = null

function createTaskLogBuffer(taskId, initialLines = []) {
  const lines = [...initialLines]

  function publish(status = 'running') {
    taskRuntimeLogs.set(taskId, {
      log: lines.join('\n'),
      status,
      updatedAt: new Date().toISOString(),
    })
  }

  publish()

  return {
    finish(status) {
      publish(status)
    },
    push(...nextLines) {
      lines.push(...nextLines)
      publish()
      return lines.length
    },
    text() {
      return lines.join('\n')
    },
  }
}

const ge2oEmbyCleanupCss = `.skinHeader .headerRight .raised.raised-mini,
.skinHeader .headerRight [title="进入 Ge2o Web"],
.skinHeader .headerRight [aria-label="进入 Ge2o Web"] {
  display: none !important;
}
`

const ge2oEmbyCleanupJs = `const openstrmBridgeCleanupHeader = () => {
  const header = document.querySelector('.skinHeader')

  if (!header) {
    return
  }

  const shouldRemove = (element) => {
    const marker = [
      element.textContent,
      element.getAttribute('title'),
      element.getAttribute('aria-label'),
      element.getAttribute('href'),
    ]
      .filter(Boolean)
      .join(' ')

    return (
      marker.includes('获取 Emby Premiere') ||
      marker.includes('Get Emby Premiere') ||
      marker.includes('进入 Ge2o Web') ||
      /\\/ge2o\\/web\\/?/i.test(marker)
    )
  }

  header.querySelectorAll('button, a').forEach((element) => {
    if (shouldRemove(element)) {
      element.remove()
    }
  })
}

openstrmBridgeCleanupHeader()
new MutationObserver(openstrmBridgeCleanupHeader).observe(document.documentElement, {
  childList: true,
  subtree: true,
})
`

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true })
}

function createSecret(length = 20) {
  return randomBytes(length).toString('base64url')
}

function getRequestOrigin(request) {
  const origin = request.headers.origin

  if (origin) {
    return origin
  }

  const host = request.headers.host
  return host ? `http://${host}` : ''
}

function normalizeOutputRoot(outputRoot) {
  const normalized = String(outputRoot ?? '')
    .trim()
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')

  if (!normalized) {
    return defaultOutputRoot
  }

  return normalized
}

function normalizeProxy302Settings(proxySettings = {}) {
  return {
    apiSecret: String(proxySettings.apiSecret || createSecret(18)),
    configPath: String(proxySettings.configPath || ge2oConfigFile),
    enabled: proxySettings.enabled !== false,
    engine: 'go-emby2openlist',
    healthy: proxySettings.healthy !== false,
    mediaServerUrl: normalizeEndpoint(proxySettings.mediaServerUrl),
    mountPath: normalizeOutputRoot(proxySettings.mountPath || defaultEmbyMountPath),
    openListStorageId: String(proxySettings.openListStorageId || ''),
    runtimeStatus: String(proxySettings.runtimeStatus || 'stopped'),
    sourcePath: String(proxySettings.sourcePath || ge2oSourceDir),
    servicePort: getProxy302Port(proxySettings),
  }
}

function normalizeEmbySettings(embySettings = {}, proxySettings = {}) {
  return {
    apiKey: String(
      embySettings.apiKey || proxySettings.embyApiKey || proxySettings.mediaServerToken || '',
    ).trim(),
  }
}

function createDefaultSettings(baseUrl = '') {
  const normalizedBaseUrl = normalizeEndpoint(baseUrl)
  const webhookToken = createSecret(12)

  return {
    proxy302: {
      apiSecret: createSecret(18),
      configPath: ge2oConfigFile,
      enabled: false,
      engine: 'go-emby2openlist',
      healthy: true,
      mediaServerUrl: '',
      mountPath: defaultEmbyMountPath,
      openListStorageId: '',
      runtimeStatus: 'stopped',
      sourcePath: ge2oSourceDir,
      servicePort: 8097,
    },
    emby: {
      apiKey: '',
    },
    strmAssistant: {
      pluginDirectory: '',
      taskSchedules: {},
    },
    strm: {
      baseUrl: normalizedBaseUrl,
      cloudNamingMode: '文件编号模式',
      encodeUrl: true,
      mediaExtensions: 'mp4,mkv,mov,avi,flv,m4v,ts,mp3,m4a,ogg,wav,aac,flac',
      minMediaSizeMb: 2,
      outputRoot: defaultOutputRoot,
      previewUrl: '',
      sidecarExtensions: 'nfo,jpg,png,ass,srt',
      signEnabled: true,
      signSecret: createSecret(15),
    },
    webhook: {
      embyDeleteSync: true,
      url: normalizedBaseUrl ? `${normalizedBaseUrl}/webhook/${webhookToken}` : '',
    },
  }
}

function mergeSettings(settings, baseUrl = '') {
  const defaults = createDefaultSettings(baseUrl)
  const nextSettings = {
    emby: normalizeEmbySettings(settings?.emby, settings?.proxy302),
    proxy302: normalizeProxy302Settings({
      ...defaults.proxy302,
      ...settings?.proxy302,
    }),
    strm: {
      ...defaults.strm,
      ...settings?.strm,
      baseUrl: normalizeEndpoint(settings?.strm?.baseUrl || baseUrl || defaults.strm.baseUrl),
      outputRoot: normalizeOutputRoot(settings?.strm?.outputRoot || defaults.strm.outputRoot),
    },
    strmAssistant: {
      ...defaults.strmAssistant,
      ...settings?.strmAssistant,
      pluginDirectory: String(settings?.strmAssistant?.pluginDirectory ?? '').trim(),
      taskSchedules:
        settings?.strmAssistant?.taskSchedules &&
        typeof settings.strmAssistant.taskSchedules === 'object' &&
        !Array.isArray(settings.strmAssistant.taskSchedules)
          ? settings.strmAssistant.taskSchedules
          : {},
    },
    webhook: {
      ...defaults.webhook,
      ...settings?.webhook,
    },
  }

  if (!nextSettings.webhook.url && nextSettings.strm.baseUrl) {
    const webhookToken = createSecret(12)
    nextSettings.webhook.url = `${nextSettings.strm.baseUrl}/webhook/${webhookToken}`
  }

  return nextSettings
}

async function readSettings(baseUrl = '') {
  await ensureDataDir()

  try {
    const content = await readFile(settingsFile, 'utf8')
    return mergeSettings(JSON.parse(content), baseUrl)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return mergeSettings(undefined, baseUrl)
    }

    throw error
  }
}

async function writeSettings(settings) {
  await ensureDataDir()
  const nextSettings = {
    ...settings,
    proxy302: {
      ...settings.proxy302,
    },
  }

  for (const runtimeKey of [
    'binaryPath',
    'configPath',
    'embyApiKey',
    'healthy',
    'logTail',
    'mediaServerToken',
    'runtimeCommand',
    'runtimeStatus',
    'sourcePath',
  ]) {
    delete nextSettings.proxy302[runtimeKey]
  }

  delete nextSettings.webhook?.cloudDriveConfig
  delete nextSettings.webhook?.cloudDriveEnabled
  delete nextSettings.webhook?.cloudDriveMapping
  delete nextSettings.webhook?.moviePilotEnabled
  delete nextSettings.webhook?.moviePilotMapping

  await writeFile(`${settingsFile}.tmp`, JSON.stringify(nextSettings, null, 2), 'utf8')
  await rename(`${settingsFile}.tmp`, settingsFile)
}

async function updateSettingsSection(section, values, baseUrl = '') {
  const currentSettings = await readSettings(baseUrl)
  const nextSettings = mergeSettings(
    {
      ...currentSettings,
      [section]: {
        ...currentSettings[section],
        ...values,
      },
    },
    baseUrl,
  )

  await writeSettings(nextSettings)
  return nextSettings[section]
}

async function readStorages() {
  await ensureDataDir()

  try {
    const content = await readFile(storagesFile, 'utf8')
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function writeStorages(storages) {
  await ensureDataDir()
  await writeFile(`${storagesFile}.tmp`, JSON.stringify(storages, null, 2), 'utf8')
  await rename(`${storagesFile}.tmp`, storagesFile)
}

async function readTasks() {
  await ensureDataDir()

  try {
    const content = await readFile(tasksFile, 'utf8')
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function writeTasks(tasks) {
  await ensureDataDir()
  await writeFile(`${tasksFile}.tmp`, JSON.stringify(tasks, null, 2), 'utf8')
  await rename(`${tasksFile}.tmp`, tasksFile)
}

async function readStrmIndex() {
  try {
    const content = await readFile(strmIndexFile, 'utf8')
    const entries = JSON.parse(content)
    return Array.isArray(entries) ? entries : []
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function writeStrmIndex(entries) {
  await ensureDataDir()
  await writeFile(`${strmIndexFile}.tmp`, JSON.stringify(entries, null, 2), 'utf8')
  await rename(`${strmIndexFile}.tmp`, strmIndexFile)
}

function normalizeStrmIndexEntry(entry) {
  return {
    indexedAt: new Date().toISOString(),
    relativePath: String(entry.relativePath ?? ''),
    sourcePath: String(entry.sourcePath ?? ''),
    sourceUrl: String(entry.sourceUrl ?? ''),
    storageId: String(entry.storageId ?? ''),
    storageName: String(entry.storageName ?? ''),
    strmEmbyPath: String(entry.strmEmbyPath ?? ''),
    strmFile: path.resolve(String(entry.strmFile ?? '')),
    strmVirtualPath: String(entry.strmVirtualPath ?? ''),
    taskId: String(entry.taskId ?? ''),
    taskName: String(entry.taskName ?? ''),
  }
}

async function upsertStrmIndexEntries(entries) {
  if (!entries.length) {
    return
  }

  const currentEntries = await readStrmIndex()
  const entriesByFile = new Map(
    currentEntries
      .filter((entry) => entry?.strmFile)
      .map((entry) => [path.resolve(String(entry.strmFile)), entry]),
  )

  for (const entry of entries.map(normalizeStrmIndexEntry)) {
    entriesByFile.set(entry.strmFile, entry)
  }

  await writeStrmIndex([...entriesByFile.values()])
}

async function removeStrmIndexEntriesByFiles(strmFiles) {
  const files = new Set(strmFiles.filter(Boolean).map((file) => path.resolve(String(file))))

  if (files.size === 0) {
    return
  }

  const currentEntries = await readStrmIndex()
  await writeStrmIndex(
    currentEntries.filter((entry) => !files.has(path.resolve(String(entry.strmFile ?? '')))),
  )
}

function getStorageIdFromPath(url) {
  const pathname = new URL(url, 'http://localhost').pathname
  const match = pathname.match(/^\/api\/storage\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : undefined
}

function getTaskRoute(url) {
  const pathname = new URL(url, 'http://localhost').pathname
  const match = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/([^/]+))?$/)

  if (!match) {
    return undefined
  }

  return {
    action: match[2],
    taskId: decodeURIComponent(match[1]),
  }
}

async function upsertStorage(storage) {
  if (!storage?.id) {
    throw new Error('缺少存储 ID')
  }

  const storages = await readStorages()
  const index = storages.findIndex((item) => item.id === storage.id)
  const nextStorage = {
    ...storage,
    lastCheck: storage.lastCheck ?? undefined,
  }

  if (index >= 0) {
    storages[index] = nextStorage
  } else {
    storages.unshift(nextStorage)
  }

  await writeStorages(storages)
  return nextStorage
}

async function deleteStorage(storageId) {
  const storages = await readStorages()
  const nextStorages = storages.filter((item) => item.id !== storageId)
  await writeStorages(nextStorages)
  return nextStorages.length !== storages.length
}

function safePathSegment(value, fallback = 'task') {
  const safeValue = String(value ?? '')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')

  return safeValue || fallback
}

function formatLocalDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function parseCronPart(part, min, max, dayOfWeek = false) {
  const values = new Set()

  for (const rawToken of String(part ?? '').split(',')) {
    const token = rawToken.trim()

    if (!token) {
      return undefined
    }

    let rangeToken = token
    let step = 1

    if (token.includes('/')) {
      const [range, stepText] = token.split('/')
      const parsedStep = Number.parseInt(stepText, 10)

      if (!range || Number.isNaN(parsedStep) || parsedStep < 1) {
        return undefined
      }

      rangeToken = range
      step = parsedStep
    }

    let start = min
    let end = max

    if (rangeToken !== '*') {
      if (rangeToken.includes('-')) {
        const [startText, endText] = rangeToken.split('-')
        start = Number.parseInt(startText, 10)
        end = Number.parseInt(endText, 10)
      } else {
        start = Number.parseInt(rangeToken, 10)
        end = start
      }
    }

    if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
      return undefined
    }

    for (let value = start; value <= end; value += step) {
      const normalizedValue = dayOfWeek && value === 7 ? 0 : value

      if (normalizedValue < min || normalizedValue > max) {
        return undefined
      }

      values.add(normalizedValue)
    }
  }

  return values
}

function calculateNextRun(schedule, fromDate = new Date()) {
  const fields = String(schedule ?? '')
    .trim()
    .split(/\s+/)

  if (fields.length !== 5) {
    return '手动运行'
  }

  const [minutePart, hourPart, dayPart, monthPart, weekPart] = fields
  const minutes = parseCronPart(minutePart, 0, 59)
  const hours = parseCronPart(hourPart, 0, 23)
  const days = parseCronPart(dayPart, 1, 31)
  const months = parseCronPart(monthPart, 1, 12)
  const weeks = parseCronPart(weekPart, 0, 6, true)

  if (!minutes || !hours || !days || !months || !weeks) {
    return '手动运行'
  }

  const nextDate = new Date(fromDate)
  nextDate.setSeconds(0, 0)
  nextDate.setMinutes(nextDate.getMinutes() + 1)

  const maxMinutes = 366 * 24 * 60

  for (let index = 0; index < maxMinutes; index += 1) {
    if (
      minutes.has(nextDate.getMinutes()) &&
      hours.has(nextDate.getHours()) &&
      days.has(nextDate.getDate()) &&
      months.has(nextDate.getMonth() + 1) &&
      weeks.has(nextDate.getDay())
    ) {
      return formatLocalDateTime(nextDate)
    }

    nextDate.setMinutes(nextDate.getMinutes() + 1)
  }

  return '手动运行'
}

function parseTaskRunDate(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)

  if (!match) {
    return undefined
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const year = Number.parseInt(yearText, 10)
  const month = Number.parseInt(monthText, 10)
  const day = Number.parseInt(dayText, 10)
  const hour = Number.parseInt(hourText, 10)
  const minute = Number.parseInt(minuteText, 10)
  const date = new Date(year, month - 1, day, hour, minute, 0, 0)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return undefined
  }

  return date
}

function getDueTaskRunDate(task, now = new Date()) {
  if (task.status === 'running' || scheduledTaskIds.has(task.id)) {
    return undefined
  }

  const nextRunDate = parseTaskRunDate(task.nextRun)

  if (!nextRunDate || nextRunDate > now) {
    return undefined
  }

  return nextRunDate
}

function getTaskOutputVirtualPath(taskName, outputRoot = defaultOutputRoot) {
  return joinPosixPath(normalizeOutputRoot(outputRoot), safePathSegment(taskName))
}

function getTaskOutputDirectory(taskName, outputRoot = defaultOutputRoot) {
  const normalizedOutputRoot = normalizeOutputRoot(outputRoot)
  const resolvedOutputRoot = path.isAbsolute(normalizedOutputRoot)
    ? normalizedOutputRoot
    : path.resolve(dataDir, normalizedOutputRoot)

  return path.join(resolvedOutputRoot, safePathSegment(taskName))
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }

    const normalized = value.trim()

    if (normalized) {
      return normalized
    }
  }

  return ''
}

function firstBoolean(defaultValue, ...values) {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value
    }
  }

  return defaultValue
}

function normalizeTaskStatus(status) {
  if (status === 'running' || status === 'failed') {
    return status
  }

  return 'idle'
}

function getTaskStorageId(task, storages) {
  const storageValue = task.storage && typeof task.storage === 'object' ? task.storage : {}
  const storageId = firstText(task.storageId, task.storage_id, task.storageID, storageValue.id)
  const storageName = firstText(
    typeof task.storage === 'string' ? task.storage : storageValue.name,
    task.storageName,
  )

  return (
    storages.find((item) => item.id === storageId)?.id ??
    storages.find((item) => item.name === storageName)?.id ??
    storageId
  )
}

function normalizeTask(task, storages, strmSettings, options = {}) {
  const taskName = firstText(task.name, task.taskName, task.title)
  const schedule =
    firstText(task.schedule, task.cron, task.crontab, task.cronExpression) || '*/5 * * * *'
  const outputRoot = strmSettings?.outputRoot ?? defaultOutputRoot
  const storageId = getTaskStorageId(task, storages)

  if (!taskName) {
    throw new Error('缺少任务名称')
  }

  if (!storageId && !options.allowMissingStorage) {
    throw new Error('缺少任务存储')
  }

  const storage = storages.find((item) => item.id === storageId)
  const nextRun = firstText(task.nextRun)

  return {
    id: task.id || `task-${Date.now()}`,
    name: taskName,
    storage:
      storage?.name ??
      firstText(
        typeof task.storage === 'string' ? task.storage : task.storage?.name,
        task.storageName,
      ),
    storageId,
    path: firstText(task.path, task.scanPath, task.scan_path, task.sourcePath) || '/',
    schedule,
    nextRun: options.preserveNextRun && nextRun ? nextRun : calculateNextRun(schedule),
    status: normalizeTaskStatus(task.status),
    directoryTimeCheck: firstBoolean(
      true,
      task.directoryTimeCheck,
      task.directoryMtimeCheck,
      task.enableDirectoryTimeCheck,
    ),
    incremental: firstBoolean(true, task.incremental, task.incrementalMode, task.enableIncremental),
    preRefreshOpenListCache: firstBoolean(
      false,
      task.preRefreshOpenListCache,
      task.preRefreshOpenlistCache,
      task.refreshOpenListCache,
      task.preRefreshAlistCache,
    ),
    outputPath: getTaskOutputVirtualPath(taskName, outputRoot),
    lastRunAt: task.lastRunAt,
    lastResult: task.lastResult,
    lastLog: task.lastLog,
  }
}

async function readTasksForClient() {
  const [tasks, storages, settings] = await Promise.all([
    readTasks(),
    readStorages(),
    readSettings(),
  ])

  return tasks.map((task) => {
    try {
      return normalizeTask(task, storages, settings.strm, {
        allowMissingStorage: true,
        preserveNextRun: true,
      })
    } catch {
      return task
    }
  })
}

async function upsertTask(task) {
  const [tasks, storages, settings] = await Promise.all([
    readTasks(),
    readStorages(),
    readSettings(),
  ])
  const nextTask = normalizeTask(task, storages, settings.strm)
  const index = tasks.findIndex((item) => item.id === nextTask.id)

  if (index >= 0) {
    tasks[index] = nextTask
  } else {
    tasks.unshift(nextTask)
  }

  await writeTasks(tasks)
  return nextTask
}

async function deleteTask(taskId) {
  const tasks = await readTasks()
  const nextTasks = tasks.filter((item) => item.id !== taskId)
  await writeTasks(nextTasks)
  return nextTasks.length !== tasks.length
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''

    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      if (!body.trim()) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function createResult(storage, result) {
  return {
    storageId: storage.id,
    method: storage.accessMethod,
    checkedAt: new Date().toISOString(),
    endpoint: result.endpoint ?? storage.endpoint,
    rootPath: result.rootPath ?? storage.rootPath,
    folders: result.folders ?? [],
    files: result.files ?? [],
    ...result,
  }
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message
  }

  return '未知错误'
}

function createHttpError(statusCode, title, message = title) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.title = title
  return error
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...options,
    })
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          stderr: stderr.trim(),
          stdout: stdout.trim(),
        })
        return
      }

      reject(
        new Error(
          [stderr.trim(), stdout.trim(), `${command} ${args.join(' ')} exited with code ${code}`]
            .filter(Boolean)
            .join('\n'),
        ),
      )
    })
  })
}

function normalizeEndpoint(endpoint) {
  return String(endpoint ?? '')
    .trim()
    .replace(/\/+$/, '')
}

function normalizeRemotePath(remotePath) {
  const trimmedPath = String(remotePath ?? '').trim()

  if (!trimmedPath) {
    return '/'
  }

  return trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`
}

function getOpenListDirectRoute(url) {
  const pathname = new URL(url, 'http://localhost').pathname
  const match = pathname.match(/^\/api\/openlist\/direct\/([^/]+)\/d(?:\/(.*))?$/)

  if (!match) {
    return undefined
  }

  const encodedRemotePath = match[2] ? `/${match[2]}` : '/'

  return {
    remotePath: normalizeRemotePath(safeDecodePathname(encodedRemotePath)),
    storageId: decodeURIComponent(match[1]),
  }
}

function joinRemotePath(basePath, name) {
  if (basePath === '/') {
    return `/${name}`
  }

  return `${basePath.replace(/\/+$/, '')}/${name}`
}

function normalizePathname(pathname) {
  const normalized = decodeURIComponent(pathname).replace(/\/+$/, '')
  return normalized || '/'
}

function encodePathSegments(remotePath) {
  const normalized = normalizeRemotePath(remotePath)

  if (normalized === '/') {
    return '/'
  }

  return normalized
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
    .replace(/^/, '/')
}

function joinEndpointAndPath(endpoint, remotePath) {
  return `${normalizeEndpoint(endpoint)}${encodePathSegments(remotePath)}`
}

function decodeXmlText(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
}

function getXmlValue(xml, tagName) {
  const matcher = new RegExp(`<[^:>/]*:?${tagName}[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${tagName}>`, 'i')
  const match = xml.match(matcher)
  return match ? decodeXmlText(match[1].trim()) : undefined
}

function getNameFromHref(href, requestUrl) {
  try {
    const request = new URL(requestUrl)
    const url = new URL(href, `${request.protocol}//${request.host}`)
    const segments = normalizePathname(url.pathname).split('/').filter(Boolean)
    return segments.at(-1) ?? ''
  } catch {
    const segments = decodeURIComponent(href).replace(/\/+$/, '').split('/').filter(Boolean)
    return segments.at(-1) ?? ''
  }
}

function isWebDavCollection(block, href, requestUrl) {
  if (/<(?:[A-Za-z_][\w.-]*:)?collection(?:\s[^>]*)?\s*\/?>/i.test(block)) {
    return true
  }

  try {
    const hrefUrl = new URL(href, requestUrl)
    return decodeURIComponent(hrefUrl.pathname).endsWith('/')
  } catch {
    return decodeURIComponent(href).endsWith('/')
  }
}

function getRelativeWebDavPath(endpoint, hrefPathname) {
  let endpointPathname

  try {
    endpointPathname = normalizePathname(new URL(endpoint).pathname)
  } catch {
    return hrefPathname
  }

  if (endpointPathname === '/') {
    return hrefPathname
  }

  if (hrefPathname === endpointPathname) {
    return '/'
  }

  if (hrefPathname.startsWith(`${endpointPathname}/`)) {
    return hrefPathname.slice(endpointPathname.length) || '/'
  }

  return hrefPathname
}

function parseSizedNumber(sizeText) {
  if (!sizeText) {
    return undefined
  }

  const size = Number.parseInt(sizeText, 10)
  return Number.isNaN(size) ? undefined : size
}

function parseWebDavEntries(xml, requestUrl, endpoint) {
  const requestPathname = normalizePathname(new URL(requestUrl).pathname)
  const responses = xml.match(/<[^:>/]*:?response[\s\S]*?<\/[^:>]*:?response>/gi) ?? []

  return responses
    .map((block) => {
      const href = getXmlValue(block, 'href')

      if (!href) {
        return undefined
      }

      const hrefPathname = normalizePathname(new URL(href, requestUrl).pathname)

      if (hrefPathname === requestPathname) {
        return undefined
      }

      const displayName = getXmlValue(block, 'displayname')
      const name = displayName || getNameFromHref(href, requestUrl)

      if (!name) {
        return undefined
      }

      const sizeText = getXmlValue(block, 'getcontentlength')
      const modified = getXmlValue(block, 'getlastmodified')
      const isFolder = isWebDavCollection(block, href, requestUrl)
      const kind = isFolder ? 'folder' : 'file'
      const entryPath = getRelativeWebDavPath(endpoint, hrefPathname)

      return {
        id: `${kind}:${entryPath}`,
        name,
        path: entryPath,
        kind,
        size: parseSizedNumber(sizeText),
        updatedAt: modified,
      }
    })
    .filter(Boolean)
}

function sortEntries(entries) {
  return entries.toSorted((first, second) => {
    if (first.kind !== second.kind) {
      return first.kind === 'folder' ? -1 : 1
    }

    return first.name.localeCompare(second.name, 'zh-CN')
  })
}

async function requestOpenListApi(endpoint, apiPath, token, init = {}) {
  const attempts = 3
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}${apiPath}`, {
        ...init,
        headers: {
          Authorization: token,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const payload = await response.json()

      if (payload.code !== 200) {
        throw new Error(payload.message || `OpenList / Alist 返回 ${payload.code}`)
      }

      return payload.data
    } catch (error) {
      lastError = error

      if (attempt < attempts) {
        await sleep(250 * attempt)
      }
    }
  }

  throw lastError
}

async function checkOpenList(storage, tokenOverride) {
  const endpoint = normalizeEndpoint(storage.endpoint)
  const token = String(tokenOverride ?? storage.openlist?.token ?? '').trim()

  if (!endpoint) {
    return createResult(storage, {
      ok: false,
      title: '缺少服务地址',
      message: 'OpenList / Alist 连通性检查需要服务地址。',
      endpoint,
    })
  }

  if (!token) {
    return createResult(storage, {
      ok: false,
      title: '需要 Token',
      message: '请输入 OpenList / Alist Token 后再执行真实连通性检查。',
      endpoint,
    })
  }

  const rootPath = normalizeRemotePath(storage.openlist?.basePath ?? storage.rootPath)
  const me = await requestOpenListApi(endpoint, '/api/me', token)
  const list = await requestOpenListApi(endpoint, '/api/fs/list', token, {
    body: JSON.stringify({
      path: rootPath,
      password: '',
      page: 1,
      per_page: 200,
      refresh: false,
    }),
    method: 'POST',
  })

  const entries = (list.content ?? []).map((entry) => {
    const name = String(entry.name ?? '').trim() || '(未命名)'
    const kind = entry.is_dir ? 'folder' : 'file'

    return {
      id: `${kind}:${joinRemotePath(rootPath, name)}`,
      name,
      path: joinRemotePath(rootPath, name),
      kind,
      size: entry.size,
      updatedAt: entry.modified,
    }
  })

  const folders = entries.filter((entry) => entry.kind === 'folder')
  const files = entries.filter((entry) => entry.kind === 'file')

  return createResult(storage, {
    ok: true,
    title: '连接成功',
    message: `后端已从 ${rootPath} 获取 ${folders.length} 个文件夹、${files.length} 个文件。`,
    endpoint,
    rootPath,
    folders,
    files,
    username: me.username,
    basePath: me.base_path ?? me.basePath,
  })
}

async function checkWebDav(storage) {
  const endpoint = normalizeEndpoint(storage.endpoint)
  const rootPath = normalizeRemotePath(storage.rootPath)

  if (!endpoint) {
    return createResult(storage, {
      ok: false,
      title: '缺少 WebDAV 地址',
      message: 'WebDAV 连通性检查需要 WebDAV 地址。',
      endpoint,
      rootPath,
    })
  }

  const requestUrl = joinEndpointAndPath(endpoint, rootPath)
  const headers = {
    Depth: '1',
    'Content-Type': 'application/xml; charset=utf-8',
  }
  const username = String(storage.webdav?.username ?? '').trim()
  const password = String(storage.webdav?.password ?? '').trim()

  if (username || password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  }

  const response = await fetch(requestUrl, {
    body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><allprop/></propfind>',
    headers,
    method: 'PROPFIND',
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const xml = await response.text()
  const entries = parseWebDavEntries(xml, requestUrl, endpoint)
  const folders = entries.filter((entry) => entry.kind === 'folder')
  const files = entries.filter((entry) => entry.kind === 'file')

  return createResult(storage, {
    ok: true,
    title: '连接成功',
    message: `后端 PROPFIND 已返回 ${folders.length} 个文件夹、${files.length} 个文件。`,
    endpoint,
    rootPath,
    folders,
    files,
  })
}

async function browseOpenList(storage, browsePath) {
  const endpoint = normalizeEndpoint(storage.endpoint)
  const token = String(storage.openlist?.token ?? '').trim()

  if (!endpoint) {
    throw new Error('OpenList / Alist 缺少服务地址')
  }

  if (!token) {
    throw new Error('OpenList / Alist 缺少 Token')
  }

  const currentPath = normalizeRemotePath(
    browsePath || storage.openlist?.basePath || storage.rootPath,
  )
  const list = await requestOpenListApi(endpoint, '/api/fs/list', token, {
    body: JSON.stringify({
      path: currentPath,
      password: '',
      page: 1,
      per_page: 500,
      refresh: false,
    }),
    method: 'POST',
  })

  const entries = (list.content ?? []).map((entry) => {
    const name = String(entry.name ?? '').trim() || '(未命名)'
    const kind = entry.is_dir ? 'folder' : 'file'

    return {
      id: `${kind}:${joinRemotePath(currentPath, name)}`,
      name,
      path: joinRemotePath(currentPath, name),
      kind,
      size: entry.size,
      updatedAt: entry.modified,
    }
  })

  return {
    path: currentPath,
    entries: sortEntries(entries),
  }
}

async function refreshOpenListDirectoryCache(storage, refreshPath) {
  const endpoint = normalizeEndpoint(storage.endpoint)
  const token = String(storage.openlist?.token ?? '').trim()

  if (!endpoint) {
    throw new Error('OpenList / Alist 缺少服务地址')
  }

  if (!token) {
    throw new Error('OpenList / Alist 缺少 Token')
  }

  const currentPath = normalizeRemotePath(
    refreshPath || storage.openlist?.basePath || storage.rootPath,
  )

  await requestOpenListApi(endpoint, '/api/fs/list', token, {
    body: JSON.stringify({
      path: currentPath,
      password: '',
      page: 1,
      per_page: 200,
      refresh: true,
    }),
    method: 'POST',
  })

  return currentPath
}

async function browseWebDav(storage, browsePath) {
  const endpoint = normalizeEndpoint(storage.endpoint)
  const currentPath = normalizeRemotePath(browsePath || storage.rootPath)

  if (!endpoint) {
    throw new Error('WebDAV 缺少地址')
  }

  const requestUrl = joinEndpointAndPath(endpoint, currentPath)
  const headers = {
    Depth: '1',
    'Content-Type': 'application/xml; charset=utf-8',
  }
  const username = String(storage.webdav?.username ?? '').trim()
  const password = String(storage.webdav?.password ?? '').trim()

  if (username || password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  }

  const response = await fetch(requestUrl, {
    body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><allprop/></propfind>',
    headers,
    method: 'PROPFIND',
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const xml = await response.text()

  return {
    path: currentPath,
    entries: sortEntries(parseWebDavEntries(xml, requestUrl, endpoint)),
  }
}

function resolveLocalBrowsePath(storage, browsePath) {
  const rootPath = String(storage.local?.path ?? storage.rootPath ?? storage.endpoint ?? '').trim()

  if (!rootPath) {
    throw new Error('本地文件缺少目录路径')
  }

  if (!browsePath || browsePath === '/') {
    return path.resolve(rootPath)
  }

  if (path.isAbsolute(browsePath)) {
    return path.resolve(browsePath)
  }

  return path.resolve(rootPath, browsePath)
}

async function browseLocal(storage, browsePath) {
  const currentPath = resolveLocalBrowsePath(storage, browsePath)
  const dirents = await readdir(currentPath, { withFileTypes: true })
  const entries = await Promise.all(
    dirents.slice(0, 500).map(async (dirent) => {
      const entryPath = path.join(currentPath, dirent.name)
      const entryStat = await stat(entryPath)
      const kind = dirent.isDirectory() ? 'folder' : 'file'

      return {
        id: `${kind}:${entryPath}`,
        name: dirent.name,
        path: entryPath,
        kind,
        size: entryStat.size,
        updatedAt: entryStat.mtime.toISOString(),
      }
    }),
  )

  return {
    path: currentPath,
    entries: sortEntries(entries),
  }
}

async function browseStorage(payload) {
  const storages = await readStorages()
  const storage = storages.find((item) => item.id === payload.storageId)

  if (!storage) {
    throw new Error('未找到存储记录')
  }

  if (storage.accessMethod === 'openlist') {
    return {
      storageId: storage.id,
      ...(await browseOpenList(storage, payload.path)),
    }
  }

  if (storage.accessMethod === 'webdav') {
    return {
      storageId: storage.id,
      ...(await browseWebDav(storage, payload.path)),
    }
  }

  if (storage.accessMethod === 'local') {
    return {
      storageId: storage.id,
      ...(await browseLocal(storage, payload.path)),
    }
  }

  throw new Error(`不支持的接入方式：${storage.accessMethod}`)
}

async function listStorageEntries(storage, currentPath) {
  if (storage.accessMethod === 'openlist') {
    return browseOpenList(storage, currentPath)
  }

  if (storage.accessMethod === 'webdav') {
    return browseWebDav(storage, currentPath)
  }

  if (storage.accessMethod === 'local') {
    return browseLocal(storage, currentPath)
  }

  throw new Error(`不支持的接入方式：${storage.accessMethod}`)
}

async function pathExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

function normalizeLocalFilePath(filePath) {
  return String(filePath ?? '').trim()
}

function getLocalFileName(filePath) {
  const normalizedPath = normalizeLocalFilePath(filePath)
  return normalizedPath.includes('\\')
    ? path.win32.basename(normalizedPath)
    : path.basename(normalizedPath)
}

async function isDirectory(directoryPath) {
  try {
    return (await stat(directoryPath)).isDirectory()
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

async function isLikelyEmbyPluginDirectory(pluginDirectory) {
  if (!(await isDirectory(pluginDirectory))) {
    return false
  }

  const parentDirectory = path.dirname(pluginDirectory)

  try {
    const entries = await readdir(pluginDirectory)
    const hasPluginDll = entries.some((entry) => entry.toLowerCase().endsWith('.dll'))
    const hasLogsDirectory = await isDirectory(path.join(parentDirectory, 'logs'))

    return hasPluginDll || hasLogsDirectory
  } catch {
    return false
  }
}

function splitPascalCase(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
}

function toCapabilityId(prefix, value) {
  return `${prefix}-${String(value)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()}`
}

function getUniqueRegexMatches(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1] || match[0]).filter(Boolean)
}

function createCapabilityItem({ entry, kind, label, mutable = false }) {
  return {
    detected: true,
    entry,
    id: toCapabilityId(kind, entry),
    kind,
    label: label || splitPascalCase(entry),
    mutable,
  }
}

function getStrmAssistantPluginVersionFromText(text) {
  const versions = [...text.matchAll(/\b\d+\.\d+\.\d+\.\d+\b/g)].map((match) => match[0])
  const pluginVersion = versions.find((version) => version.startsWith('2.')) || versions[0]

  return pluginVersion || ''
}

function detectStrmAssistantCapabilitiesFromText(text, editable) {
  const featureEntries = Object.keys(strmAssistantFeatureLabels).filter((entry) =>
    text.includes(entry),
  )
  const optionEntries = [
    ...new Set(
      getUniqueRegexMatches(text, /\b([A-Z][A-Za-z0-9]*Options)\b/g).filter(
        (entry) =>
          entry in strmAssistantOptionLabels ||
          /^PluginOptions_|^GeneralOptions_|^MetadataEnhanceOptions_/.test(entry),
      ),
    ),
  ].sort()
  const taskEntries = [
    ...new Set(
      getUniqueRegexMatches(text, /\b([A-Z][A-Za-z0-9]*Task)\b/g).filter(
        (entry) =>
          entry in strmAssistantTaskLabels ||
          (/Task$/.test(entry) &&
            ![
              'AsyncTask',
              'CompletedTask',
              'ConfiguredTask',
              'IConfigurableScheduledTask',
              'IScheduledTask',
              'ITask',
              'ScheduledTask',
              'Task',
              'ValueTask',
            ].includes(entry)),
      ),
    ),
  ].sort()
  const apiEntries = [
    ...new Set([
      ...Object.keys(strmAssistantApiLabels).filter((entry) => text.includes(entry)),
      ...getUniqueRegexMatches(text, /\b([A-Z][A-Za-z0-9]*Api)\b/g),
    ]),
  ]
    .filter((entry) => !['InvalidAltMovieDbApi', 'MovieDbApi'].includes(entry))
    .sort()

  return {
    apiItems: apiEntries.map((entry) =>
      createCapabilityItem({
        entry,
        kind: 'api',
        label:
          strmAssistantApiLabels[entry] ||
          strmAssistantFeatureLabels[entry] ||
          splitPascalCase(entry),
      }),
    ),
    controlItems: [
      ...optionEntries.map((entry) =>
        createCapabilityItem({
          entry,
          kind: 'option',
          label: strmAssistantOptionLabels[entry] || splitPascalCase(entry),
          mutable: editable,
        }),
      ),
      ...taskEntries.map((entry) =>
        createCapabilityItem({
          entry,
          kind: 'task',
          label: strmAssistantTaskLabels[entry] || splitPascalCase(entry),
        }),
      ),
    ],
    editable,
    features: featureEntries.map((entry) =>
      createCapabilityItem({
        entry,
        kind: 'feature',
        label: strmAssistantFeatureLabels[entry],
      }),
    ),
    pluginVersion: getStrmAssistantPluginVersionFromText(text),
    source: 'dll-static',
  }
}

async function getStrmAssistantCapabilities(sourceFile, editable) {
  try {
    const dllBuffer = await readFile(sourceFile)
    const dllText = `${dllBuffer.toString('latin1')}\n${dllBuffer.toString('utf16le')}`

    return detectStrmAssistantCapabilitiesFromText(dllText, editable)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }

    return {
      apiItems: [],
      controlItems: [],
      editable: false,
      features: [],
      pluginVersion: '',
      source: 'dll-static',
    }
  }
}

function getUniqueDockerContainerNames(names) {
  return Array.from(new Set(names.map((name) => String(name ?? '').trim()).filter(Boolean)))
}

async function listDockerContainerNames() {
  try {
    const { stdout } = await runProcess('docker', ['ps', '-a', '--format', '{{.Names}}'])

    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

async function getEmbyContainerCandidates() {
  return getUniqueDockerContainerNames([
    defaultEmbyContainerName,
    ...commonEmbyContainerNames,
    ...(await listDockerContainerNames()),
  ])
}

async function inspectDockerContainer(containerName) {
  try {
    const { stdout } = await runProcess('docker', ['inspect', containerName])
    const containers = JSON.parse(stdout)

    return containers?.[0] ?? null
  } catch {
    return null
  }
}

function getDockerPluginDirectoryFromMount(containerName, mount) {
  const destination = String(mount.Destination ?? '').replace(/\/+$/, '')
  const source = String(mount.Source ?? '')

  if (!source) {
    return null
  }

  if (destination === '/config/plugins') {
    return {
      containerPluginDirectory: strmAssistantContainerPluginDirectory,
      embyContainerName: containerName,
      found: true,
      pluginDirectory: source,
      source: 'docker:/config/plugins',
    }
  }

  if (destination === '/config') {
    return {
      containerPluginDirectory: strmAssistantContainerPluginDirectory,
      embyContainerName: containerName,
      found: true,
      pluginDirectory: path.join(source, 'plugins'),
      source: 'docker:/config',
    }
  }

  return null
}

async function getDockerEmbyPluginDirectories() {
  const directories = []

  for (const containerName of await getEmbyContainerCandidates()) {
    const container = await inspectDockerContainer(containerName)
    const mounts = Array.isArray(container?.Mounts) ? container.Mounts : []

    for (const mount of mounts) {
      const directory = getDockerPluginDirectoryFromMount(containerName, mount)

      if (!directory) {
        continue
      }

      directories.push(directory)
    }
  }

  return directories
}

async function detectDockerEmbyPluginDirectory() {
  const directories = await getDockerEmbyPluginDirectories()

  return directories[0] ?? null
}

async function detectDockerContainerForPluginDirectory(pluginDirectory) {
  const resolvedPluginDirectory = path.resolve(pluginDirectory)

  for (const directory of await getDockerEmbyPluginDirectories()) {
    if (path.resolve(directory.pluginDirectory) === resolvedPluginDirectory) {
      return directory
    }
  }

  return null
}

async function detectEmbyPluginDirectory(baseUrl = '') {
  const settings = await readSettings(baseUrl)
  const manualPluginDirectory = String(settings.strmAssistant?.pluginDirectory ?? '').trim()

  if (manualPluginDirectory) {
    const dockerDirectory = await detectDockerContainerForPluginDirectory(manualPluginDirectory)

    return {
      containerPluginDirectory: dockerDirectory?.containerPluginDirectory ?? '',
      embyContainerName: dockerDirectory?.embyContainerName ?? '',
      found: true,
      pluginDirectory: manualPluginDirectory,
      source: 'manual',
    }
  }

  if (configuredEmbyPluginDirectory) {
    const dockerDirectory = await detectDockerContainerForPluginDirectory(
      configuredEmbyPluginDirectory,
    )

    return {
      containerPluginDirectory: dockerDirectory?.containerPluginDirectory ?? '',
      embyContainerName: dockerDirectory?.embyContainerName ?? '',
      found: true,
      pluginDirectory: configuredEmbyPluginDirectory,
      source: 'env',
    }
  }

  const dockerDirectory = await detectDockerEmbyPluginDirectory()

  if (dockerDirectory) {
    return dockerDirectory
  }

  const candidates = [
    path.join(dataDir, 'emby', 'config', 'plugins'),
    '/root/emby/config/plugins',
    '/var/lib/emby/plugins',
    '/var/lib/emby-server/plugins',
    '/config/plugins',
  ]

  for (const candidate of candidates) {
    if (await isLikelyEmbyPluginDirectory(candidate)) {
      return {
        containerPluginDirectory: '',
        embyContainerName: '',
        found: true,
        pluginDirectory: candidate,
        source: 'known-path',
      }
    }
  }

  for (const candidate of candidates) {
    if (await isDirectory(candidate)) {
      return {
        containerPluginDirectory: '',
        embyContainerName: '',
        found: true,
        pluginDirectory: candidate,
        source: 'existing-directory',
      }
    }
  }

  return {
    containerPluginDirectory: '',
    embyContainerName: '',
    found: false,
    pluginDirectory: process.platform === 'win32' ? candidates[0] : '/root/emby/config/plugins',
    source: 'fallback',
  }
}

async function getEmbyPluginDefaults(baseUrl = '') {
  const detection = await detectEmbyPluginDirectory(baseUrl)

  return {
    containerPluginDirectory: detection.containerPluginDirectory,
    embyContainerName: detection.embyContainerName ?? '',
    pluginDirectory: detection.pluginDirectory,
    sourceFile: bundledStrmAssistantPluginFile,
  }
}

async function getEmbyPluginStatus(baseUrl = '') {
  const sourceFile = bundledStrmAssistantPluginFile
  const settings = await readSettings(baseUrl)
  const detection = await detectEmbyPluginDirectory(baseUrl)
  const pluginDirectory = detection.pluginDirectory
  const pluginFileName = strmAssistantInstalledPluginFileName
  const targetFile = pluginDirectory ? path.join(pluginDirectory, pluginFileName) : ''
  const installed = Boolean(targetFile && (await pathExists(targetFile)))
  const capabilities = await getStrmAssistantCapabilities(sourceFile, installed)

  return {
    capabilities,
    containerPluginDirectory: detection.containerPluginDirectory,
    detectionSource: detection.source,
    embyContainerName: detection.embyContainerName ?? '',
    foundPluginDirectory: detection.found,
    installed,
    pluginDirectory,
    pluginFileName,
    sourceExists: Boolean(sourceFile && (await pathExists(sourceFile))),
    sourceFile,
    taskSchedules: settings.strmAssistant?.taskSchedules ?? {},
    targetFile,
  }
}

async function installEmbyPlugin(baseUrl = '') {
  const sourceFile = bundledStrmAssistantPluginFile
  const detection = await detectEmbyPluginDirectory(baseUrl)
  const pluginDirectory = detection.pluginDirectory
  const sourceExtension = path.extname(sourceFile).toLowerCase()

  if (!sourceFile) {
    throw new Error('缺少插件 DLL 源文件路径')
  }

  if (sourceExtension !== '.dll') {
    throw new Error('插件源文件必须是 .dll 文件')
  }

  if (!detection.found || !pluginDirectory) {
    throw new Error('未找到 Emby 插件目录')
  }

  const sourceStat = await stat(sourceFile).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new Error(`未找到插件 DLL：${sourceFile}`)
    }

    throw error
  })

  if (!sourceStat.isFile()) {
    throw new Error(`插件源路径不是文件：${sourceFile}`)
  }

  await mkdir(pluginDirectory, { recursive: true })

  const targetFile = path.join(pluginDirectory, strmAssistantInstalledPluginFileName)

  if (path.resolve(sourceFile) !== path.resolve(targetFile)) {
    await copyFile(sourceFile, targetFile)
  }

  const targetStat = await stat(targetFile)
  const capabilities = await getStrmAssistantCapabilities(sourceFile, true)

  return {
    capabilities,
    containerPluginDirectory: detection.containerPluginDirectory,
    detectionSource: detection.source,
    embyContainerName: detection.embyContainerName ?? '',
    foundPluginDirectory: true,
    installed: true,
    message: '神医助手插件已安装到 Emby 插件目录。',
    pluginDirectory,
    pluginFileName: strmAssistantInstalledPluginFileName,
    size: targetStat.size,
    sourceFile,
    taskSchedules: (await readSettings(baseUrl)).strmAssistant?.taskSchedules ?? {},
    targetFile,
    updatedAt: targetStat.mtime.toISOString(),
  }
}

async function restartEmbyServer(embyContainerName) {
  if (!embyContainerName) {
    return {
      embyContainerName: '',
      restartOutput: '',
      restarted: false,
    }
  }

  const result = await runProcess('docker', ['restart', embyContainerName])

  return {
    embyContainerName,
    restartOutput: result.stdout || result.stderr,
    restarted: true,
  }
}

async function startStrmAssistant(baseUrl = '') {
  const installedPlugin = await installEmbyPlugin(baseUrl)

  try {
    const restartResult = await restartEmbyServer(installedPlugin.embyContainerName)

    return {
      ...installedPlugin,
      ...restartResult,
      message: restartResult.restarted
        ? `神医助手已启动：插件已安装并已重启 Emby 容器 ${restartResult.embyContainerName}。`
        : '神医助手插件已安装，请手动重启 Emby 后生效。',
    }
  } catch (error) {
    throw new Error(`插件已复制到 Emby 插件目录，但重启 Emby 失败：${getErrorMessage(error)}`)
  }
}

async function updateEmbyPluginDirectory(values, baseUrl = '') {
  const pluginDirectory = String(values?.pluginDirectory ?? '').trim()

  if (!pluginDirectory) {
    throw new Error('请填写 Emby 插件目录')
  }

  await updateSettingsSection('strmAssistant', { pluginDirectory }, baseUrl)

  return {
    ...(await getEmbyPluginDefaults(baseUrl)),
    status: await getEmbyPluginStatus(baseUrl),
  }
}

function normalizeStrmAssistantTaskSchedule(values = {}) {
  const taskId = String(values.taskId ?? '').trim()
  const taskName = String(values.taskName ?? '').trim()
  const rawModes = Array.isArray(values.modes)
    ? values.modes
    : [values.mode === 'after-strm' ? 'after-strm' : 'hourly']
  const modes = [...new Set(rawModes.filter((mode) => mode === 'hourly' || mode === 'after-strm'))]
  const intervalHours = Math.max(
    1,
    Math.min(168, Number.parseInt(String(values.intervalHours ?? '1'), 10) || 1),
  )

  if (!taskId) {
    throw new Error('缺少计划任务标识')
  }

  if (!taskName) {
    throw new Error('缺少计划任务名称')
  }

  if (modes.length === 0) {
    throw new Error('请至少选择一种执行逻辑')
  }

  return {
    enabled: values.enabled !== false,
    intervalHours,
    lastTriggeredAt: String(values.lastTriggeredAt ?? ''),
    mode: modes[0],
    modes,
    taskId,
    taskName,
    updatedAt: new Date().toISOString(),
  }
}

async function updateStrmAssistantTaskSchedule(values, baseUrl = '') {
  const currentSettings = await readSettings(baseUrl)
  const nextSchedule = normalizeStrmAssistantTaskSchedule(values)
  const previousSchedule = currentSettings.strmAssistant?.taskSchedules?.[nextSchedule.taskId] ?? {}
  const taskSchedules = {
    ...(currentSettings.strmAssistant?.taskSchedules ?? {}),
    [nextSchedule.taskId]: {
      ...previousSchedule,
      ...nextSchedule,
      embyTaskId: previousSchedule.embyTaskId,
      embyTaskName: previousSchedule.embyTaskName,
      embyTaskState: previousSchedule.embyTaskState,
      lastError: previousSchedule.lastError,
      lastFinishedAt: previousSchedule.lastFinishedAt,
      lastTriggeredAt: nextSchedule.lastTriggeredAt || previousSchedule.lastTriggeredAt || '',
      runMessage: previousSchedule.runMessage,
      runProgress: previousSchedule.runProgress,
      runStatus: previousSchedule.runStatus,
      runUpdatedAt: previousSchedule.runUpdatedAt,
    },
  }

  await updateSettingsSection('strmAssistant', { taskSchedules }, baseUrl)

  return {
    ...(await getEmbyPluginDefaults(baseUrl)),
    status: await getEmbyPluginStatus(baseUrl),
  }
}

function getStrmAssistantTaskDefinition(taskId) {
  const normalizedTaskId = String(taskId ?? '').trim()
  const className = strmAssistantTaskClassById[normalizedTaskId]

  if (!className) {
    throw new Error('不支持的神医助手计划任务')
  }

  return {
    className,
    labels: [
      strmAssistantTaskTitlesById[normalizedTaskId],
      strmAssistantTaskLabels[className],
      splitPascalCase(className),
    ].filter(Boolean),
    taskId: normalizedTaskId,
    taskName:
      strmAssistantTaskTitlesById[normalizedTaskId] ||
      strmAssistantTaskLabels[className] ||
      splitPascalCase(className),
  }
}

function getEmbyScheduledTaskId(task) {
  return String(task?.Id ?? task?.id ?? task?.TaskId ?? task?.taskId ?? '').trim()
}

function getEmbyApiConfig(settings) {
  const mediaServerUrl = normalizeEndpoint(settings.proxy302?.mediaServerUrl)
  const embyApiKey = String(
    settings.emby?.apiKey ||
      settings.proxy302?.embyApiKey ||
      settings.proxy302?.mediaServerToken ||
      '',
  ).trim()

  if (!mediaServerUrl && !embyApiKey) {
    throw new Error(
      '请先在系统设置中填写 Emby 服务地址，并在 Emby 授权页面填写从 Emby 控制台获取的 API Key。',
    )
  }

  if (!embyApiKey) {
    throw new Error(
      '未配置 Emby API Key。请先在 Emby 控制台的 API Keys 中新建秘钥，然后填写到系统设置的 Emby 授权页面。',
    )
  }

  if (!mediaServerUrl) {
    throw new Error('请先在系统设置的 302代理 中填写 Emby 服务地址，代理可保持关闭。')
  }

  return {
    embyApiKey,
    mediaServerUrl,
  }
}

async function requestEmbyApi(settings, apiPath, init = {}) {
  const { embyApiKey, mediaServerUrl } = getEmbyApiConfig(settings)
  const targetUrl = new URL(apiPath, `${mediaServerUrl}/`)
  const headers = {
    Accept: 'application/json',
    'X-Emby-Token': embyApiKey,
    ...(init.headers ?? {}),
  }

  if (!targetUrl.searchParams.has('api_key')) {
    targetUrl.searchParams.set('api_key', embyApiKey)
  }

  const upstream = await fetch(targetUrl, {
    ...init,
    headers,
  })
  const text = await upstream.text()

  if (!upstream.ok) {
    throw new Error(
      [`Emby API 请求失败 (${upstream.status})`, text.trim().slice(0, 220)]
        .filter(Boolean)
        .join('：'),
    )
  }

  if (!text.trim()) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function fetchEmbyScheduledTasks(settings) {
  const payload = await requestEmbyApi(settings, '/ScheduledTasks')

  if (Array.isArray(payload)) {
    return payload
  }

  if (Array.isArray(payload?.Items)) {
    return payload.Items
  }

  return []
}

function normalizeTaskSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_\-:：/\\()[\]{}"'.,，。]+/g, '')
}

function getEmbyTaskSearchText(task) {
  const directText = [
    task?.Id,
    task?.Key,
    task?.Name,
    task?.Description,
    task?.Category,
    task?.Type,
    task?.ClassName,
    task?.TaskType,
  ]
    .filter(Boolean)
    .join(' ')

  return normalizeTaskSearchText(`${directText} ${JSON.stringify(task ?? {})}`)
}

function findStrmAssistantScheduledTask(tasks, definition, preferredTaskId = '') {
  const preferredId = String(preferredTaskId ?? '').trim()

  if (preferredId) {
    const preferredTask = tasks.find((task) => getEmbyScheduledTaskId(task) === preferredId)

    if (preferredTask) {
      return preferredTask
    }
  }

  const className = normalizeTaskSearchText(definition.className)
  const labelCandidates = definition.labels.map(normalizeTaskSearchText).filter(Boolean)

  return (
    tasks.find((task) => getEmbyTaskSearchText(task).includes(className)) ??
    tasks.find((task) => {
      const taskName = normalizeTaskSearchText(task?.Name ?? task?.Description ?? '')

      return labelCandidates.some(
        (label) => taskName.includes(label) || (label.includes(taskName) && taskName.length >= 4),
      )
    }) ??
    null
  )
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}

function clampProgress(value) {
  return Math.max(0, Math.min(100, Math.round(toFiniteNumber(value))))
}

function parseDateTime(value) {
  const date = new Date(value ?? '')

  return Number.isNaN(date.getTime()) ? null : date
}

function getEmbyTaskLastExecutionResult(task) {
  return task?.LastExecutionResult ?? task?.lastExecutionResult ?? task?.LastResult ?? null
}

function getEmbyTaskRunSnapshot(task, definition, previousSchedule = {}) {
  const lastResult = getEmbyTaskLastExecutionResult(task)
  const state = String(task?.State ?? task?.Status ?? task?.state ?? '').trim()
  const normalizedState = state.toLowerCase()
  const rawProgress =
    task?.CurrentProgressPercentage ??
    task?.CurrentProgress ??
    task?.ProgressPercentage ??
    task?.Progress ??
    task?.PercentComplete
  const currentProgress = clampProgress(rawProgress)
  const lastTriggeredAt = parseDateTime(previousSchedule.lastTriggeredAt)
  const resultEndAt = parseDateTime(
    lastResult?.EndTimeUtc ??
      lastResult?.EndTime ??
      lastResult?.CompletedAt ??
      lastResult?.Date ??
      lastResult?.Time,
  )
  const resultStatus = String(lastResult?.Status ?? lastResult?.Result ?? '').toLowerCase()
  const resultAfterTrigger =
    Boolean(lastTriggeredAt && resultEndAt) && resultEndAt.getTime() >= lastTriggeredAt.getTime()
  let runStatus = previousSchedule.runStatus || 'idle'
  let runProgress = previousSchedule.runProgress ?? 0
  let runMessage = previousSchedule.runMessage || '未执行'

  if (normalizedState.includes('running')) {
    runStatus = 'running'
    runProgress = currentProgress
    runMessage = '正在执行'
  } else if (resultAfterTrigger) {
    if (resultStatus.includes('fail') || resultStatus.includes('error')) {
      runStatus = 'failed'
      runProgress = currentProgress
      runMessage = '执行失败'
    } else {
      runStatus = 'succeeded'
      runProgress = 100
      runMessage = '执行完成'
    }
  } else if (['queued', 'running'].includes(previousSchedule.runStatus)) {
    runStatus = 'queued'
    runProgress = previousSchedule.runProgress ?? 0
    runMessage = '已提交执行，等待 Emby 更新状态'
  }

  return {
    embyTaskId: getEmbyScheduledTaskId(task),
    embyTaskName: String(task?.Name ?? definition.taskName),
    embyTaskState: state || 'Unknown',
    lastError: runStatus === 'failed' ? String(lastResult?.ErrorMessage ?? '') : '',
    lastFinishedAt: resultAfterTrigger && resultEndAt ? resultEndAt.toISOString() : '',
    runMessage,
    runProgress,
    runStatus,
    runUpdatedAt: new Date().toISOString(),
    taskId: definition.taskId,
    taskName: definition.taskName,
  }
}

async function updateStrmAssistantTaskRunState(taskId, patch, baseUrl = '') {
  const definition = getStrmAssistantTaskDefinition(taskId)
  const currentSettings = await readSettings(baseUrl)
  const previousSchedule = currentSettings.strmAssistant?.taskSchedules?.[definition.taskId] ?? {}
  const now = new Date().toISOString()
  const nextSchedule = {
    enabled: previousSchedule.enabled === true,
    intervalHours: previousSchedule.intervalHours || 1,
    mode: previousSchedule.mode || 'hourly',
    modes:
      Array.isArray(previousSchedule.modes) && previousSchedule.modes.length > 0
        ? previousSchedule.modes
        : ['hourly'],
    taskId: definition.taskId,
    taskName: previousSchedule.taskName || definition.taskName,
    updatedAt: previousSchedule.updatedAt || now,
    ...previousSchedule,
    ...patch,
    runUpdatedAt: patch.runUpdatedAt || now,
  }
  const taskSchedules = {
    ...(currentSettings.strmAssistant?.taskSchedules ?? {}),
    [definition.taskId]: nextSchedule,
  }

  await updateSettingsSection('strmAssistant', { taskSchedules }, baseUrl)

  return nextSchedule
}

async function getStrmAssistantTaskRun(taskId, baseUrl = '') {
  const definition = getStrmAssistantTaskDefinition(taskId)
  const settings = await readSettings(baseUrl)
  const previousSchedule = settings.strmAssistant?.taskSchedules?.[definition.taskId] ?? {}
  const tasks = await fetchEmbyScheduledTasks(settings)
  const task = findStrmAssistantScheduledTask(tasks, definition, previousSchedule.embyTaskId)

  if (!task) {
    const nextSchedule = await updateStrmAssistantTaskRunState(
      definition.taskId,
      {
        lastError: '未在 Emby 计划任务中找到对应的神医助手任务',
        runMessage: '未找到 Emby 任务',
        runProgress: previousSchedule.runProgress ?? 0,
        runStatus: 'failed',
      },
      baseUrl,
    )

    return {
      schedule: nextSchedule,
      status: await getEmbyPluginStatus(baseUrl),
    }
  }

  const snapshot = getEmbyTaskRunSnapshot(task, definition, previousSchedule)
  const nextSchedule = await updateStrmAssistantTaskRunState(definition.taskId, snapshot, baseUrl)

  return {
    schedule: nextSchedule,
    status: await getEmbyPluginStatus(baseUrl),
  }
}

async function runStrmAssistantTaskOnce(taskId, baseUrl = '') {
  const definition = getStrmAssistantTaskDefinition(taskId)
  const settings = await readSettings(baseUrl)
  const tasks = await fetchEmbyScheduledTasks(settings)
  const previousSchedule = settings.strmAssistant?.taskSchedules?.[definition.taskId] ?? {}
  const task = findStrmAssistantScheduledTask(tasks, definition, previousSchedule.embyTaskId)

  if (!task) {
    throw new Error('未在 Emby 计划任务中找到对应的神医助手任务，请确认 Emby 已重启且插件已生效')
  }

  const embyTaskId = getEmbyScheduledTaskId(task)

  if (!embyTaskId) {
    throw new Error('Emby 返回的计划任务缺少任务 ID')
  }

  await requestEmbyApi(settings, `/ScheduledTasks/Running/${encodeURIComponent(embyTaskId)}`, {
    method: 'POST',
  })

  const schedule = await updateStrmAssistantTaskRunState(
    definition.taskId,
    {
      embyTaskId,
      embyTaskName: String(task?.Name ?? definition.taskName),
      embyTaskState: String(task?.State ?? task?.Status ?? 'Submitted'),
      lastError: '',
      lastTriggeredAt: new Date().toISOString(),
      runMessage: '已提交执行',
      runProgress: 0,
      runStatus: 'queued',
    },
    baseUrl,
  )

  return {
    schedule,
    status: await getEmbyPluginStatus(baseUrl),
  }
}

async function markStrmAssistantTasksTriggeredAfterStrm(task, result) {
  const currentSettings = await readSettings()
  const taskSchedules = currentSettings.strmAssistant?.taskSchedules ?? {}
  const now = new Date().toISOString()
  const triggered = Object.values(taskSchedules)
    .filter((schedule) => {
      const modes = Array.isArray(schedule?.modes) ? schedule.modes : [schedule?.mode]
      return schedule?.enabled !== false && modes.includes('after-strm')
    })
    .map((schedule) => ({
      ...schedule,
      lastSourceTaskId: task.id,
      lastSourceTaskName: task.name,
      lastSourceTaskFinishedAt: result.finishedAt,
      lastTriggeredAt: now,
    }))

  if (triggered.length === 0) {
    return []
  }

  const nextTaskSchedules = {
    ...taskSchedules,
  }

  for (const schedule of triggered) {
    nextTaskSchedules[schedule.taskId] = schedule
  }

  await updateSettingsSection('strmAssistant', { taskSchedules: nextTaskSchedules })

  return triggered
}

function getConfiguredMediaExtensions(strmSettings) {
  const extensions = String(strmSettings?.mediaExtensions ?? '')
    .split(',')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean)
    .map((extension) => (extension.startsWith('.') ? extension : `.${extension}`))

  return extensions.length > 0 ? new Set(extensions) : defaultMediaExtensions
}

function isMediaEntry(entry, strmSettings) {
  if (entry.kind !== 'file') {
    return false
  }

  const extensions = getConfiguredMediaExtensions(strmSettings)

  if (!extensions.has(path.extname(entry.name).toLowerCase())) {
    return false
  }

  const minSizeMb = Number(strmSettings?.minMediaSizeMb ?? 0)

  if (typeof entry.size !== 'number' || Number.isNaN(minSizeMb) || minSizeMb <= 0) {
    return true
  }

  return entry.size >= minSizeMb * 1024 * 1024
}

function getRemoteRelativePath(rootPath, entryPath) {
  const root = normalizeRemotePath(rootPath).replace(/\/+$/, '')
  const target = normalizeRemotePath(entryPath)

  if (root === '' || root === '/') {
    return target.replace(/^\/+/, '')
  }

  if (target.startsWith(`${root}/`)) {
    return target.slice(root.length + 1)
  }

  return target.replace(/^\/+/, '')
}

function getEntryRelativePath(storage, scanRoot, entry) {
  if (storage.accessMethod !== 'local') {
    return getRemoteRelativePath(scanRoot, entry.path)
  }

  const resolvedScanRoot = resolveLocalBrowsePath(storage, scanRoot)
  const relativePath = path.relative(resolvedScanRoot, path.resolve(entry.path))
  return relativePath || path.basename(entry.path)
}

function getOutputFilePath(outputDirectory, relativePath) {
  const segments = String(relativePath)
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => safePathSegment(segment))
  const fileName = segments.pop() ?? 'media'
  const extension = path.extname(fileName)
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName

  return path.join(outputDirectory, ...segments, `${baseName}.strm`)
}

function toPosixPath(value) {
  return String(value ?? '').replace(/\\/g, '/')
}

function joinPosixPath(basePath, relativePath) {
  const base = toPosixPath(basePath).replace(/\/+$/, '')
  const relative = toPosixPath(relativePath).replace(/^\/+/, '')

  if (!relative) {
    return base || '/'
  }

  return `${base}/${relative}`.replace(/\/+/g, '/')
}

function getTaskOutputEmbyPath(taskName, settings = {}) {
  const mountPath = settings.proxy302?.mountPath || defaultEmbyMountPath
  return joinPosixPath(mountPath, safePathSegment(taskName))
}

function createStrmIndexEntry(
  task,
  storage,
  strmSettings,
  settings,
  outputFile,
  relativePath,
  entryPath,
) {
  const outputDirectory = getTaskOutputDirectory(task.name, strmSettings.outputRoot)
  const strmRelativePath = path.relative(outputDirectory, outputFile) || relativePath

  return {
    relativePath: strmRelativePath,
    sourcePath: entryPath,
    sourceUrl: createStrmUrl(storage, entryPath),
    storageId: storage.id,
    storageName: storage.name,
    strmEmbyPath: joinPosixPath(getTaskOutputEmbyPath(task.name, settings), strmRelativePath),
    strmFile: outputFile,
    strmVirtualPath: joinPosixPath(
      getTaskOutputVirtualPath(task.name, strmSettings.outputRoot),
      strmRelativePath,
    ),
    taskId: task.id,
    taskName: task.name,
  }
}

function getUnencodedRemotePath(remotePath) {
  return normalizeRemotePath(remotePath).split('/').filter(Boolean).join('/').replace(/^/, '/')
}

function createStrmUrl(storage, entryPath) {
  if (storage.accessMethod === 'openlist') {
    const baseUrl = normalizeEndpoint(storage.openlist?.strmBaseUrl || storage.endpoint)
    const remotePath =
      storage.openlist?.enableUrlEncoding === false
        ? getUnencodedRemotePath(entryPath)
        : encodePathSegments(entryPath)

    return `${baseUrl}/d${remotePath}`
  }

  if (storage.accessMethod === 'webdav') {
    return joinEndpointAndPath(storage.endpoint, entryPath)
  }

  return path.resolve(entryPath)
}

async function collectMediaEntries(storage, scanPath, logLines, strmSettings) {
  const pendingDirectories = [scanPath || '/']
  const mediaEntries = []
  let scannedDirectories = 0
  let failedDirectories = 0

  while (pendingDirectories.length > 0) {
    if (
      scannedDirectories >= scanLimits.directories ||
      mediaEntries.length >= scanLimits.mediaFiles
    ) {
      logLines.push('达到扫描上限，已停止继续递归。')
      break
    }

    const currentPath = pendingDirectories.shift()

    try {
      const result = await listStorageEntries(storage, currentPath)
      scannedDirectories += 1
      logLines.push(`读取目录: ${result.path}`)

      for (const entry of result.entries) {
        if (entry.kind === 'folder') {
          pendingDirectories.push(entry.path)
        } else if (isMediaEntry(entry, strmSettings)) {
          mediaEntries.push(entry)

          if (mediaEntries.length >= scanLimits.mediaFiles) {
            break
          }
        }
      }
    } catch (error) {
      failedDirectories += 1
      logLines.push(`目录读取失败: ${currentPath} - ${getErrorMessage(error)}`)
    }
  }

  return {
    failedDirectories,
    mediaEntries,
    scannedDirectories,
  }
}

async function executeTask(task, storage, strmSettings, settings = {}) {
  const startedAt = new Date()
  const outputPath = getTaskOutputVirtualPath(task.name, strmSettings.outputRoot)
  const outputDirectory = getTaskOutputDirectory(task.name, strmSettings.outputRoot)
  const logLines = createTaskLogBuffer(task.id, [
    `${formatLocalDateTime(startedAt)} 开始任务: ${task.name}`,
    `任务类型: 生成 STRM`,
    `使用存储: ${storage.name}`,
    `扫描路径: ${task.path}`,
    `保存目录: ${outputPath}`,
    `目录时间检查: ${task.directoryTimeCheck ? 'true' : 'false'}`,
    `增量生成模式: ${task.incremental ? 'true' : 'false'}`,
    `预先刷新 OpenList 缓存: ${task.preRefreshOpenListCache ? 'true' : 'false'}`,
    `媒体后缀: ${strmSettings.mediaExtensions}`,
    `媒体大小阈值: ${strmSettings.minMediaSizeMb} MB`,
    '------------------------------------------------------------',
  ])

  await mkdir(outputDirectory, { recursive: true })

  if (task.preRefreshOpenListCache) {
    if (storage.accessMethod === 'openlist') {
      try {
        const refreshedPath = await refreshOpenListDirectoryCache(storage, task.path)
        logLines.push(`已刷新 OpenList 目录缓存: ${refreshedPath}`)
      } catch (error) {
        logLines.push(`OpenList 目录缓存刷新失败: ${getErrorMessage(error)}`)
      }
    } else {
      logLines.push('跳过 OpenList 目录缓存刷新：当前任务存储不是 OpenList / Alist。')
    }
  }

  const { failedDirectories, mediaEntries, scannedDirectories } = await collectMediaEntries(
    storage,
    task.path,
    logLines,
    strmSettings,
  )

  let generated = 0
  let skipped = 0
  let failed = 0
  const strmIndexEntries = []

  logLines.push(
    `扫描完成，共读取 ${scannedDirectories} 个目录，发现 ${mediaEntries.length} 个媒体文件。`,
  )
  logLines.push('>>> 开始生成')

  for (const entry of mediaEntries) {
    const relativePath = getEntryRelativePath(storage, task.path, entry)
    const outputFile = getOutputFilePath(outputDirectory, relativePath)
    const sourceUrl = createStrmUrl(storage, entry.path)

    try {
      if (task.incremental && (await pathExists(outputFile))) {
        skipped += 1
        strmIndexEntries.push(
          createStrmIndexEntry(
            task,
            storage,
            strmSettings,
            settings,
            outputFile,
            relativePath,
            entry.path,
          ),
        )
        continue
      }

      await mkdir(path.dirname(outputFile), { recursive: true })
      await writeFile(outputFile, `${sourceUrl}\n`, 'utf8')
      strmIndexEntries.push(
        createStrmIndexEntry(
          task,
          storage,
          strmSettings,
          settings,
          outputFile,
          relativePath,
          entry.path,
        ),
      )
      generated += 1

      if (generated <= 50) {
        logLines.push(`生成: ${path.relative(outputDirectory, outputFile)}`)
      }
    } catch (error) {
      failed += 1
      logLines.push(`生成失败: ${entry.path} - ${getErrorMessage(error)}`)
    }
  }

  try {
    await upsertStrmIndexEntries(strmIndexEntries)
    logLines.push(`已更新 STRM 索引: ${strmIndexEntries.length} 条`)
  } catch (error) {
    failed += 1
    logLines.push(`更新 STRM 索引失败: ${getErrorMessage(error)}`)
  }

  const finishedAt = new Date()
  const ok = failed === 0 && failedDirectories === 0

  logLines.push(
    `生成完成，共发现 ${mediaEntries.length} 个媒体文件，生成 ${generated} 个，跳过 ${skipped} 个，失败 ${failed} 个，目录读取失败 ${failedDirectories} 个。`,
  )
  logLines.push(`${formatLocalDateTime(finishedAt)} 任务完成`)
  logLines.finish(ok ? 'idle' : 'failed')

  return {
    log: logLines.text(),
    result: {
      failed,
      failedDirectories,
      finishedAt: finishedAt.toISOString(),
      generated,
      mediaFiles: mediaEntries.length,
      ok,
      outputPath,
      scannedDirectories,
      skipped,
      startedAt: startedAt.toISOString(),
    },
  }
}

async function saveTaskRunState(taskId, patch) {
  const tasks = await readTasks()
  const nextTasks = tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task))
  const nextTask = nextTasks.find((task) => task.id === taskId)

  await writeTasks(nextTasks)

  if (!nextTask) {
    throw new Error('未找到任务记录')
  }

  return nextTask
}

async function runTask(taskId) {
  const [tasks, storages, settings] = await Promise.all([
    readTasks(),
    readStorages(),
    readSettings(),
  ])
  const task = tasks.find((item) => item.id === taskId)

  if (!task) {
    throw new Error('未找到任务记录')
  }

  const storage = storages.find((item) => item.id === task.storageId)

  if (!storage) {
    throw new Error('任务引用的存储不存在')
  }

  await saveTaskRunState(taskId, { status: 'running' })

  let execution

  try {
    execution = await executeTask(task, storage, settings.strm, settings)
  } catch (error) {
    const failedAt = new Date()
    const currentLog = taskRuntimeLogs.get(taskId)?.log
    const failedLog = [
      currentLog,
      `${formatLocalDateTime(failedAt)} 任务失败: ${getErrorMessage(error)}`,
    ]
      .filter(Boolean)
      .join('\n')

    taskRuntimeLogs.set(taskId, {
      log: failedLog,
      status: 'failed',
      updatedAt: failedAt.toISOString(),
    })

    await saveTaskRunState(taskId, {
      lastLog: failedLog,
      lastRunAt: failedAt.toISOString(),
      nextRun: calculateNextRun(task.schedule),
      status: 'failed',
    })

    throw error
  }

  const nextStatus = execution.result.ok ? 'idle' : 'failed'
  const updatedTask = await saveTaskRunState(taskId, {
    lastLog: execution.log,
    lastResult: execution.result,
    lastRunAt: execution.result.finishedAt,
    nextRun: calculateNextRun(task.schedule),
    outputPath: execution.result.outputPath,
    status: nextStatus,
  })

  taskRuntimeLogs.set(taskId, {
    log: execution.log,
    status: nextStatus,
    updatedAt: execution.result.finishedAt,
  })

  if (execution.result.ok) {
    const triggeredSchedules = await markStrmAssistantTasksTriggeredAfterStrm(
      task,
      execution.result,
    )

    if (triggeredSchedules.length > 0) {
      const triggerLog = [
        execution.log,
        '------------------------------------------------------------',
        ...triggeredSchedules.map((schedule) => `已触发神医助手计划任务: ${schedule.taskName}`),
      ].join('\n')

      await saveTaskRunState(taskId, {
        lastLog: triggerLog,
      })

      taskRuntimeLogs.set(taskId, {
        log: triggerLog,
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  return {
    result: execution.result,
    task: updatedTask,
  }
}

async function stopTask(taskId) {
  return saveTaskRunState(taskId, { status: 'idle' })
}

async function runAllTasks() {
  const tasks = await readTasks()
  const results = []

  for (const task of tasks) {
    try {
      results.push(await runTask(task.id))
    } catch (error) {
      results.push({
        error: getErrorMessage(error),
        task,
      })
    }
  }

  return {
    results,
    tasks: await readTasks(),
  }
}

async function runDueScheduledTasks() {
  if (taskSchedulerRunning) {
    return
  }

  taskSchedulerRunning = true

  try {
    const now = new Date()
    const tasks = await readTasks()
    const dueTasks = tasks
      .map((task) => ({
        dueAt: getDueTaskRunDate(task, now),
        task,
      }))
      .filter((entry) => entry.dueAt)
      .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())

    for (const { task } of dueTasks) {
      scheduledTaskIds.add(task.id)

      try {
        console.log(
          `OpenStrmBridge scheduled task started: ${task.name} (${task.nextRun || 'unknown'})`,
        )
        await runTask(task.id)
      } catch (error) {
        console.error(`OpenStrmBridge scheduled task failed: ${getErrorMessage(error)}`)
      } finally {
        scheduledTaskIds.delete(task.id)
      }
    }
  } finally {
    taskSchedulerRunning = false
  }
}

function startTaskScheduler() {
  if (taskSchedulerIntervalMs <= 0 || taskSchedulerTimer) {
    return
  }

  const tick = async () => {
    try {
      await runDueScheduledTasks()
    } catch (error) {
      console.error(`OpenStrmBridge task scheduler failed: ${getErrorMessage(error)}`)
    } finally {
      taskSchedulerTimer = setTimeout(tick, taskSchedulerIntervalMs)
      taskSchedulerTimer.unref?.()
    }
  }

  taskSchedulerTimer = setTimeout(tick, 1000)
  taskSchedulerTimer.unref?.()
}

async function checkLocal(storage) {
  const rootPath = String(storage.local?.path ?? storage.rootPath ?? storage.endpoint ?? '').trim()

  if (!rootPath) {
    return createResult(storage, {
      ok: false,
      title: '缺少本地路径',
      message: '本地文件连通性检查需要目录路径。',
      endpoint: '',
      rootPath: '',
    })
  }

  const resolvedRoot = path.resolve(rootPath)
  const dirents = await readdir(resolvedRoot, { withFileTypes: true })
  const entries = await Promise.all(
    dirents.slice(0, 200).map(async (dirent) => {
      const entryPath = path.join(resolvedRoot, dirent.name)
      const entryStat = await stat(entryPath)
      const kind = dirent.isDirectory() ? 'folder' : 'file'

      return {
        id: `${kind}:${entryPath}`,
        name: dirent.name,
        path: entryPath,
        kind,
        size: entryStat.size,
        updatedAt: entryStat.mtime.toISOString(),
      }
    }),
  )
  const folders = entries.filter((entry) => entry.kind === 'folder')
  const files = entries.filter((entry) => entry.kind === 'file')

  return createResult(storage, {
    ok: true,
    title: '连接成功',
    message: `后端已读取本地目录，获取 ${folders.length} 个文件夹、${files.length} 个文件。`,
    endpoint: resolvedRoot,
    rootPath: resolvedRoot,
    folders,
    files,
  })
}

async function checkStorage(payload) {
  const storage = payload.storage

  if (!storage?.accessMethod) {
    throw new Error('缺少存储配置')
  }

  try {
    if (storage.accessMethod === 'openlist') {
      return await checkOpenList(storage, payload.token)
    }

    if (storage.accessMethod === 'webdav') {
      return await checkWebDav(storage)
    }

    if (storage.accessMethod === 'local') {
      return await checkLocal(storage)
    }

    throw new Error(`不支持的接入方式：${storage.accessMethod}`)
  } catch (error) {
    return createResult(storage, {
      ok: false,
      title: '连接失败',
      message: getErrorMessage(error),
      endpoint: storage.endpoint,
      rootPath: storage.rootPath,
    })
  }
}

const hopByHopHeaders = new Set([
  'accept-encoding',
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

let embyProxyServer = null
let ge2oProcess = null
let activeGe2oPort = null
let activeGe2oRuntimeCommand = ''
let activeGe2oRuntimePath = ''
let ge2oLastError = ''
const ge2oLogs = []

function appendGe2oLog(chunk) {
  const text = String(chunk ?? '')

  if (!text) {
    return
  }

  ge2oLogs.push(text)

  while (ge2oLogs.length > 80) {
    ge2oLogs.shift()
  }
}

function getGe2oHttpsPort(servicePort) {
  if (servicePort !== 8094) {
    return 8094
  }

  return servicePort === 65535 ? 8093 : servicePort + 1
}

function yamlScalar(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`
}

function yamlLines(items, indent = '  ') {
  if (!items.length) {
    return `${indent}[]`
  }

  return items.map((item) => `${indent}- ${item}`).join('\n')
}

function getLocalBackendBaseUrl() {
  return normalizeEndpoint(ge2oPublicBackendUrl) || `http://127.0.0.1:${port}`
}

function getStorageDownloadBaseUrl(storage) {
  const baseUrl = normalizeEndpoint(storage.openlist?.strmBaseUrl || storage.endpoint)

  if (!baseUrl) {
    return ''
  }

  try {
    const url = new URL(baseUrl)
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/d`.replace(/\/+/g, '/')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function getOpenListStorages(storages) {
  return storages.filter((storage) => {
    return (
      storage?.accessMethod === 'openlist' &&
      normalizeEndpoint(storage.endpoint) &&
      String(storage.openlist?.token ?? '').trim()
    )
  })
}

function getPrimaryOpenListStorage(storages, proxySettings = {}) {
  const candidates = getOpenListStorages(storages)

  if (!candidates.length) {
    return null
  }

  const preferredStorageId = String(proxySettings.openListStorageId ?? '').trim()

  return candidates.find((storage) => storage.id === preferredStorageId) ?? candidates[0]
}

function createGe2oPathMaps(storages) {
  const backendBaseUrl = getLocalBackendBaseUrl()

  return getOpenListStorages(storages)
    .map((storage) => {
      const from = getStorageDownloadBaseUrl(storage)

      if (!from) {
        return ''
      }

      const to = `${backendBaseUrl}/api/openlist/direct/${encodeURIComponent(storage.id)}/d`
      return `${from} => ${to}`
    })
    .filter(Boolean)
}

function createGe2oConfig(settings, storages) {
  const proxySettings = settings.proxy302
  const primaryStorage = getPrimaryOpenListStorage(storages, proxySettings)

  if (!primaryStorage) {
    throw new Error('请先在存储管理中添加并保存 OpenList / Alist 存储 Token')
  }

  const embyHost = normalizeEndpoint(proxySettings.mediaServerUrl)
  const openListHost = normalizeEndpoint(primaryStorage.endpoint)
  const openListToken = String(primaryStorage.openlist?.token ?? '').trim()
  const mountPath = normalizeOutputRoot(proxySettings.mountPath || defaultEmbyMountPath)
  const pathMaps = createGe2oPathMaps(storages)
  const apiSecret = String(proxySettings.apiSecret || createSecret(18))

  if (!embyHost) {
    throw new Error('请先填写 Emby 服务地址')
  }

  if (!openListHost || !openListToken) {
    throw new Error('OpenList / Alist 存储缺少服务地址或 Token')
  }

  return `emby:
  host: ${yamlScalar(embyHost)}
  mount-path: ${yamlScalar(mountPath)}
  episodes-unplay-prior: true
  resort-random-items: true
  proxy-error-strategy: origin
  images-quality: 90
  strm:
    path-map:
${yamlLines(pathMaps, '      ')}
    internal-redirect-enable: false
  download-strategy: direct
  local-media-roots: []
  custom-css-js:
    debug-mode: false

openlist:
  host: ${yamlScalar(openListHost)}
  token: ${yamlScalar(openListToken)}
  local-tree-gen:
    enable: false
    ffmpeg-enable: false
    virtual-containers: mp4,mkv
    strm-containers: ts
    music-containers: mp3,flac
    auto-remove-max-count: 6000
    refresh-interval: 10
    scan-prefixes:
      - /
    allow-containers: ass,srt,sub
    threads: 8

video-preview:
  enable: false
  containers:
    - mp4
    - mkv
  ignore-template-ids:
    - LD
    - SD

path:
  emby2openlist: []

cache:
  enable: true
  expired: 1d

ssl:
  enable: false
  single-port: false
  key: testssl.cn.key
  crt: testssl.cn.crt

log:
  disable-color: true

ge2o:
  api-secret: ${yamlScalar(apiSecret)}
  web:
    disable: false
    disable-emby-btn: true
`
}

async function resolveGe2oRuntimeCommand(servicePort, httpsPort) {
  if (await pathExists(packagedGe2oBinaryFile)) {
    return {
      args: ['-p', String(servicePort), '-ps', String(httpsPort), '-dr', ge2oDataDir],
      command: packagedGe2oBinaryFile,
      cwd: process.cwd(),
      label: 'ge2o binary',
      sourcePath: packagedGe2oBinaryFile,
    }
  }

  try {
    const sourceStat = await stat(ge2oSourceDir)

    if (!sourceStat.isDirectory()) {
      throw new Error('not a directory')
    }
  } catch {
    throw new Error(
      `未找到 go-emby2openlist 二进制或源码目录：${packagedGe2oBinaryFile}；${ge2oSourceDir}`,
    )
  }

  return {
    args: ['run', '.', '-p', String(servicePort), '-ps', String(httpsPort), '-dr', ge2oDataDir],
    command: 'go',
    cwd: ge2oSourceDir,
    label: 'go run',
    sourcePath: ge2oSourceDir,
  }
}

async function writeGe2oCustomAssets() {
  await mkdir(ge2oCustomCssDir, { recursive: true })
  await mkdir(ge2oCustomJsDir, { recursive: true })
  await writeFile(ge2oEmbyCleanupCssFile, ge2oEmbyCleanupCss, 'utf8')
  await writeFile(ge2oEmbyCleanupJsFile, ge2oEmbyCleanupJs, 'utf8')
}

async function writeGe2oRuntimeConfig(settings, storages) {
  await mkdir(ge2oDataDir, { recursive: true })
  await writeGe2oCustomAssets()
  const config = createGe2oConfig(settings, storages)
  await writeFile(`${ge2oConfigFile}.tmp`, config, 'utf8')
  await rename(`${ge2oConfigFile}.tmp`, ge2oConfigFile)
}

function getGe2oRuntimeStatus(proxySettings = {}) {
  const servicePort = getProxy302Port(proxySettings)
  const running =
    ge2oProcess !== null &&
    ge2oProcess.exitCode === null &&
    !ge2oProcess.killed &&
    activeGe2oPort === servicePort

  return {
    configPath: ge2oConfigFile,
    engine: 'go-emby2openlist',
    healthy: Boolean(proxySettings.enabled !== false && running),
    logTail: ge2oLogs.join('').slice(-6000),
    runtimeStatus: running ? 'running' : ge2oLastError ? 'failed' : 'stopped',
    runtimeCommand: activeGe2oRuntimeCommand || 'auto',
    sourcePath: activeGe2oRuntimePath || packagedGe2oBinaryFile || ge2oSourceDir,
  }
}

async function stopGe2oProxyProcess() {
  if (!ge2oProcess) {
    activeGe2oPort = null
    return
  }

  const child = ge2oProcess
  ge2oProcess = null
  activeGe2oPort = null

  if (child.exitCode !== null || child.killed) {
    return
  }

  child.kill()

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2500)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function startGe2oProxyProcess(settings, storages) {
  const proxySettings = settings.proxy302
  const servicePort = getProxy302Port(proxySettings)
  const httpsPort = getGe2oHttpsPort(servicePort)
  const runtimeCommand = await resolveGe2oRuntimeCommand(servicePort, httpsPort)

  await writeGe2oRuntimeConfig(settings, storages)
  await stopGe2oProxyProcess()

  ge2oLastError = ''
  ge2oLogs.length = 0

  const child = spawn(runtimeCommand.command, runtimeCommand.args, {
    cwd: runtimeCommand.cwd,
    env: {
      ...process.env,
      GIN_MODE: 'release',
    },
    windowsHide: true,
  })

  child.stdout?.on('data', appendGe2oLog)
  child.stderr?.on('data', appendGe2oLog)
  child.once('error', (error) => {
    ge2oLastError = getErrorMessage(error)
    appendGe2oLog(`\n[openstrmbridge] ge2o start error: ${ge2oLastError}\n`)
  })
  child.once('exit', (code, signal) => {
    if (ge2oProcess === child) {
      ge2oProcess = null
      activeGe2oPort = null
    }

    if (code !== 0 && signal !== 'SIGTERM') {
      ge2oLastError = `go-emby2openlist 已退出，code=${code ?? 'null'} signal=${signal ?? 'null'}`
      appendGe2oLog(`\n[openstrmbridge] ${ge2oLastError}\n`)
    }
  })

  ge2oProcess = child
  activeGe2oPort = servicePort
  activeGe2oRuntimeCommand = runtimeCommand.label
  activeGe2oRuntimePath = runtimeCommand.sourcePath

  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 1200)

    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`go-emby2openlist 启动后立即退出，code=${code ?? 'null'}`))
    })
  })

  console.log(`OpenStrmBridge go-emby2openlist proxy listening on http://127.0.0.1:${servicePort}`)
}

function getHeaderValue(value) {
  if (Array.isArray(value)) {
    return value.join(', ')
  }

  return typeof value === 'string' ? value : ''
}

function filterProxyHeaders(headers) {
  const nextHeaders = {}

  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase()

    if (hopByHopHeaders.has(normalizedName) || normalizedName === 'host') {
      continue
    }

    const headerValue = getHeaderValue(value)

    if (headerValue) {
      nextHeaders[name] = headerValue
    }
  }

  return nextHeaders
}

function getProxy302Port(proxySettings) {
  const servicePort = Number.parseInt(String(proxySettings?.servicePort ?? ''), 10)

  if (!Number.isInteger(servicePort) || servicePort < 1 || servicePort > 65535) {
    return 8097
  }

  return servicePort
}

function sendProxyText(response, statusCode, title, message) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
  })
  response.end(`${title}\n${message}`)
}

function redirectTo(response, targetUrl) {
  response.writeHead(302, {
    'Cache-Control': 'no-store',
    Location: targetUrl,
  })
  response.end()
}

function getEmbyProxyTargetUrl(mediaServerUrl, requestUrl) {
  return new URL(requestUrl || '/', `${normalizeEndpoint(mediaServerUrl)}/`)
}

function getEmbyItemIdFromPlaybackRequest(requestUrl) {
  const { pathname, searchParams } = new URL(requestUrl || '/', 'http://openstrmbridge.local')
  const patterns = [
    /^\/videos\/([^/]+)\/(?:stream|original|main|master)(?:[./]|$)/i,
    /^\/audio\/([^/]+)\/stream(?:[./]|$)/i,
    /^\/items\/([^/]+)\/(?:download|file)(?:\/|$)/i,
  ]

  for (const pattern of patterns) {
    const match = pathname.match(pattern)

    if (match?.[1]) {
      return decodeURIComponent(match[1])
    }
  }

  return searchParams.get('ItemId') || searchParams.get('itemId') || ''
}

function getEmbyUserId(request, requestUrl) {
  const { searchParams } = new URL(requestUrl || '/', 'http://openstrmbridge.local')
  const queryUserId = searchParams.get('UserId') || searchParams.get('userId')

  if (queryUserId) {
    return queryUserId
  }

  const embyAuthorization = getHeaderValue(request.headers['x-emby-authorization'])
  const userIdMatch = embyAuthorization.match(/UserId="?([^",]+)"?/i)

  return userIdMatch?.[1] ?? ''
}

function appendEmbyAuthParams(targetUrl, incomingUrl) {
  const authParamNames = ['api_key', 'ApiKey', 'X-Emby-Token', 'UserId', 'userId']

  for (const name of authParamNames) {
    const value = incomingUrl.searchParams.get(name)

    if (value && !targetUrl.searchParams.has(name)) {
      targetUrl.searchParams.set(name, value)
    }
  }
}

async function fetchEmbyJson(mediaServerUrl, request, apiPath) {
  const incomingUrl = new URL(request.url || '/', 'http://openstrmbridge.local')
  const targetUrl = new URL(apiPath, `${normalizeEndpoint(mediaServerUrl)}/`)
  const headers = filterProxyHeaders(request.headers)

  appendEmbyAuthParams(targetUrl, incomingUrl)
  headers.Accept = 'application/json'

  const upstream = await fetch(targetUrl, {
    headers,
    method: 'GET',
    redirect: 'manual',
  })

  if (!upstream.ok) {
    return null
  }

  const contentType = upstream.headers.get('content-type') ?? ''

  if (!contentType.toLowerCase().includes('json')) {
    return null
  }

  return upstream.json()
}

async function fetchEmbyItemPayloads(mediaServerUrl, request, itemId) {
  const userId = getEmbyUserId(request, request.url)
  const itemPaths = [`/Items/${encodeURIComponent(itemId)}`]

  if (userId) {
    itemPaths.push(`/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}`)
  }

  itemPaths.push(`/Items/${encodeURIComponent(itemId)}/PlaybackInfo`)

  const payloads = []

  for (const itemPath of itemPaths) {
    try {
      const payload = await fetchEmbyJson(mediaServerUrl, request, itemPath)

      if (payload) {
        payloads.push(payload)
      }
    } catch (error) {
      console.warn(`Emby item lookup failed: ${itemPath} - ${getErrorMessage(error)}`)
    }
  }

  return payloads
}

function addDirectCandidate(candidates, value) {
  const candidate = String(value ?? '').trim()

  if (!candidate || candidates.includes(candidate)) {
    return
  }

  candidates.push(candidate)
}

function collectDirectCandidates(payload, candidates = []) {
  if (!payload || typeof payload !== 'object') {
    return candidates
  }

  const candidateKeys = new Set([
    'directstreamurl',
    'file',
    'filename',
    'filepath',
    'itempath',
    'localpath',
    'location',
    'mediapath',
    'originalpath',
    'path',
    'sourcepath',
    'streamurl',
    'transcodingurl',
    'url',
  ])

  if (Array.isArray(payload)) {
    for (const item of payload) {
      collectDirectCandidates(item, candidates)
    }

    return candidates
  }

  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = key.toLowerCase()

    if (typeof value === 'string' && candidateKeys.has(normalizedKey)) {
      addDirectCandidate(candidates, value)
    }

    if (value && typeof value === 'object') {
      collectDirectCandidates(value, candidates)
    }
  }

  return candidates
}

async function readStrmTarget(candidate) {
  const filePath = String(candidate ?? '').trim()

  if (!filePath.toLowerCase().endsWith('.strm')) {
    return ''
  }

  try {
    const content = await readFile(filePath, 'utf8')
    const firstLine = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)

    return firstLine ?? ''
  } catch (error) {
    console.warn(`Read STRM target failed: ${filePath} - ${getErrorMessage(error)}`)
    return ''
  }
}

function safeDecodePathname(pathname) {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

function getOpenListRemotePathFromUrl(rawUrl, storage) {
  let candidateUrl

  try {
    candidateUrl = new URL(rawUrl)
  } catch {
    return ''
  }

  const baseUrls = [storage.openlist?.strmBaseUrl, storage.endpoint].filter(Boolean)
  const candidatePathname = safeDecodePathname(candidateUrl.pathname).replace(/\/+$/, '')

  for (const rawBaseUrl of baseUrls) {
    let baseUrl

    try {
      baseUrl = new URL(normalizeEndpoint(rawBaseUrl))
    } catch {
      continue
    }

    if (candidateUrl.origin !== baseUrl.origin) {
      continue
    }

    const basePathname = safeDecodePathname(baseUrl.pathname).replace(/\/+$/, '')
    const downloadPrefix = `${basePathname}/d`.replace(/\/+/g, '/')

    if (candidatePathname === downloadPrefix) {
      return '/'
    }

    if (candidatePathname.startsWith(`${downloadPrefix}/`)) {
      return normalizeRemotePath(candidatePathname.slice(downloadPrefix.length))
    }
  }

  return ''
}

function normalizeAbsoluteUrl(rawUrl, baseUrl) {
  const value = String(rawUrl ?? '').trim()

  if (/^https?:\/\//i.test(value)) {
    return value
  }

  if (value.startsWith('//')) {
    return `http:${value}`
  }

  if (value.startsWith('/')) {
    return new URL(value, `${normalizeEndpoint(baseUrl)}/`).toString()
  }

  return ''
}

async function resolveOpenListRawUrl(rawUrl, storages) {
  for (const storage of storages) {
    if (storage.accessMethod !== 'openlist') {
      continue
    }

    const remotePath = getOpenListRemotePathFromUrl(rawUrl, storage)

    if (!remotePath) {
      continue
    }

    const endpoint = normalizeEndpoint(storage.endpoint)
    const token = String(storage.openlist?.token ?? '').trim()

    if (!endpoint || !token) {
      return rawUrl
    }

    try {
      const fileInfo = await requestOpenListApi(endpoint, '/api/fs/get', token, {
        body: JSON.stringify({
          path: remotePath,
          password: '',
        }),
        method: 'POST',
      })
      const directUrl = normalizeAbsoluteUrl(
        fileInfo.raw_url ?? fileInfo.rawUrl ?? fileInfo.url ?? fileInfo.sign_url,
        endpoint,
      )

      return directUrl || rawUrl
    } catch (error) {
      console.warn(`OpenList direct link lookup failed: ${remotePath} - ${getErrorMessage(error)}`)
      return rawUrl
    }
  }

  return rawUrl
}

async function redirectOpenListDirectLink(request, response) {
  const route = getOpenListDirectRoute(request.url)

  if (!route) {
    sendJson(response, 404, {
      ok: false,
      title: 'Not Found',
      message: '直链兑换接口不存在',
    })
    return
  }

  try {
    const storages = await readStorages()
    const storage = storages.find((item) => item.id === route.storageId)

    if (!storage || storage.accessMethod !== 'openlist') {
      throw new Error('未找到可用的 OpenList / Alist 存储')
    }

    const endpoint = normalizeEndpoint(storage.endpoint)
    const token = String(storage.openlist?.token ?? '').trim()

    if (!endpoint || !token) {
      throw new Error('OpenList / Alist 存储缺少服务地址或 Token')
    }

    const fileInfo = await requestOpenListApi(endpoint, '/api/fs/get', token, {
      body: JSON.stringify({
        path: route.remotePath,
        password: '',
      }),
      method: 'POST',
    })
    const directUrl = normalizeAbsoluteUrl(
      fileInfo.raw_url ?? fileInfo.rawUrl ?? fileInfo.url ?? fileInfo.sign_url,
      endpoint,
    )

    if (!directUrl) {
      throw new Error('OpenList / Alist 未返回可播放直链')
    }

    redirectTo(response, directUrl)
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      title: 'OpenList 直链兑换失败',
      message: getErrorMessage(error),
    })
  }
}

async function resolveDirectCandidate(candidate, storages, depth = 0) {
  const value = String(candidate ?? '').trim()

  if (!value || depth > 3) {
    return ''
  }

  const strmTarget = await readStrmTarget(value)

  if (strmTarget) {
    return resolveDirectCandidate(strmTarget, storages, depth + 1)
  }

  if (!/^https?:\/\//i.test(value)) {
    return ''
  }

  return resolveOpenListRawUrl(value, storages)
}

async function resolveEmbyDirectPlaybackUrl(mediaServerUrl, request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return ''
  }

  const itemId = getEmbyItemIdFromPlaybackRequest(request.url)

  if (!itemId) {
    return ''
  }

  const [payloads, storages] = await Promise.all([
    fetchEmbyItemPayloads(mediaServerUrl, request, itemId),
    readStorages(),
  ])

  for (const payload of payloads) {
    const candidates = collectDirectCandidates(payload)

    for (const candidate of candidates) {
      const directUrl = await resolveDirectCandidate(candidate, storages)

      if (directUrl) {
        return directUrl
      }
    }
  }

  return ''
}

function getWebhookRoute(requestUrl) {
  const url = new URL(requestUrl || '/', 'http://openstrmbridge.local')
  const match = url.pathname.match(/^\/webhook\/([^/]+)$/)

  if (!match) {
    return undefined
  }

  const dryRunValue = url.searchParams.get('dryRun') || url.searchParams.get('dry_run')

  return {
    dryRun: ['1', 'true', 'yes'].includes(String(dryRunValue ?? '').toLowerCase()),
    token: decodeURIComponent(match[1]),
  }
}

function getWebhookTokenFromSettings(settings) {
  const webhookUrl = String(settings.webhook?.url ?? '').trim()

  try {
    const url = new URL(webhookUrl)
    const segments = url.pathname.split('/').filter(Boolean)
    return segments.at(-1) ?? ''
  } catch {
    const segments = webhookUrl.split(/[/?#]/)[0].split('/').filter(Boolean)
    return segments.at(-1) ?? ''
  }
}

function collectWebhookEventValues(payload, values = []) {
  if (!payload || typeof payload !== 'object') {
    return values
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      collectWebhookEventValues(item, values)
    }

    return values
  }

  const eventKeys = new Set(['event', 'eventname', 'eventtype', 'notificationtype', 'type'])

  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = key.toLowerCase()

    if (typeof value === 'string' && eventKeys.has(normalizedKey)) {
      values.push(value)
    }

    if (value && typeof value === 'object') {
      collectWebhookEventValues(value, values)
    }
  }

  return values
}

function isDeleteWebhookPayload(payload) {
  const eventText = collectWebhookEventValues(payload).join(' ').toLowerCase()
  return /delete|deleted|remove|removed|itemdeleted|item\.deleted|删除/.test(eventText)
}

function getWebhookCandidatePathValue(value) {
  const candidate = String(value ?? '').trim()

  if (!candidate) {
    return ''
  }

  try {
    const url = new URL(candidate)

    if (url.protocol === 'file:') {
      return fileURLToPath(url)
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return safeDecodePathname(url.pathname)
    }
  } catch {
    return candidate
  }

  return candidate
}

function normalizeWebhookComparePath(value) {
  const candidate = getWebhookCandidatePathValue(value)
  return safeDecodePathname(candidate).replace(/\\/g, '/').replace(/\/+$/, '')
}

function isSameWebhookPath(first, second) {
  const normalizedFirst = normalizeWebhookComparePath(first)
  const normalizedSecond = normalizeWebhookComparePath(second)
  return normalizedFirst !== '' && normalizedFirst === normalizedSecond
}

function isWebhookPathInside(candidate, rootPath) {
  const normalizedCandidate = normalizeWebhookComparePath(candidate)
  const normalizedRoot = normalizeWebhookComparePath(rootPath)

  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot.replace(/\/+$/, '')}/`)
  )
}

function isStrmPathCandidate(value) {
  return normalizeWebhookComparePath(value).endsWith('.strm')
}

function getLocalPathFromWebhookCandidate(value) {
  const candidate = getWebhookCandidatePathValue(value)

  if (!candidate) {
    return ''
  }

  if (/^[A-Za-z]:[\\/]/.test(candidate) || path.isAbsolute(candidate)) {
    return path.resolve(candidate)
  }

  return ''
}

function isLocalPathInside(candidatePath, rootPath) {
  const resolvedCandidate = path.resolve(candidatePath)
  const resolvedRoot = path.resolve(rootPath)
  const relativePath = path.relative(resolvedRoot, resolvedCandidate)

  return (
    relativePath === '' ||
    (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  )
}

function isRemotePathInside(candidatePath, rootPath) {
  const normalizedCandidate = normalizeRemotePath(candidatePath).replace(/\/+$/, '')
  const normalizedRoot = normalizeRemotePath(rootPath).replace(/\/+$/, '')

  if (normalizedRoot === '' || normalizedRoot === '/') {
    return true
  }

  return (
    normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
  )
}

function getTaskForStrmFile(strmFile, tasks, settings) {
  const resolvedStrmFile = path.resolve(strmFile)

  return tasks.find((task) => {
    const outputDirectory = getTaskOutputDirectory(task.name, settings.strm.outputRoot)
    return isLocalPathInside(resolvedStrmFile, outputDirectory)
  })
}

function getTaskRelativeStrmPath(strmFile, task, settings) {
  if (!task) {
    return ''
  }

  const outputDirectory = getTaskOutputDirectory(task.name, settings.strm.outputRoot)

  if (!isLocalPathInside(strmFile, outputDirectory)) {
    return ''
  }

  return path.relative(outputDirectory, strmFile)
}

function getTaskStrmPathAliases(task, settings, relativePath = '') {
  return [
    joinPosixPath(getTaskOutputVirtualPath(task.name, settings.strm.outputRoot), relativePath),
    joinPosixPath(getTaskOutputEmbyPath(task.name, settings), relativePath),
  ]
}

function getIndexStrmAliases(entry) {
  return [entry.strmFile, entry.strmVirtualPath, entry.strmEmbyPath].filter(Boolean)
}

function findStrmIndexEntryByFile(strmFile, indexEntries) {
  return indexEntries.find((entry) => isSameWebhookPath(entry.strmFile, strmFile))
}

async function resolveWebhookStrmCandidate(candidate, tasks, settings, indexEntries) {
  for (const entry of indexEntries) {
    if (getIndexStrmAliases(entry).some((alias) => isSameWebhookPath(alias, candidate))) {
      return {
        candidate,
        indexEntry: entry,
        strmFile: entry.strmFile,
        task: tasks.find((task) => task.id === entry.taskId),
      }
    }
  }

  const localPath = getLocalPathFromWebhookCandidate(candidate)

  if (localPath && (await pathExists(localPath))) {
    const task = getTaskForStrmFile(localPath, tasks, settings)
    return {
      candidate,
      indexEntry: findStrmIndexEntryByFile(localPath, indexEntries),
      strmFile: localPath,
      task,
    }
  }

  for (const task of tasks) {
    const aliases = getTaskStrmPathAliases(task, settings)

    for (const aliasRoot of aliases) {
      if (!isWebhookPathInside(candidate, aliasRoot)) {
        continue
      }

      const relativePath = normalizeWebhookComparePath(candidate).slice(
        normalizeWebhookComparePath(aliasRoot).length,
      )
      const strmFile = path.join(
        getTaskOutputDirectory(task.name, settings.strm.outputRoot),
        ...relativePath.split('/').filter(Boolean),
      )

      return {
        candidate,
        indexEntry: findStrmIndexEntryByFile(strmFile, indexEntries),
        strmFile,
        task,
      }
    }
  }

  return {
    candidate,
    error: '未找到对应的本地 STRM 文件或索引',
  }
}

function getWebDavRemotePathFromUrl(rawUrl, storage) {
  try {
    const candidateUrl = new URL(rawUrl)
    const endpointUrl = new URL(normalizeEndpoint(storage.endpoint))

    if (candidateUrl.origin !== endpointUrl.origin) {
      return ''
    }

    return getRelativeWebDavPath(
      normalizeEndpoint(storage.endpoint),
      safeDecodePathname(candidateUrl.pathname),
    )
  } catch {
    return ''
  }
}

function getStorageSourcePathFromTarget(storage, target) {
  if (storage.accessMethod === 'openlist') {
    return getOpenListRemotePathFromUrl(target, storage)
  }

  if (storage.accessMethod === 'webdav') {
    return getWebDavRemotePathFromUrl(target, storage)
  }

  if (storage.accessMethod === 'local') {
    const localPath = getLocalPathFromWebhookCandidate(target)
    return localPath ? path.resolve(localPath) : ''
  }

  return ''
}

function assertSourceInsideTask(storage, task, sourcePath) {
  if (!task) {
    return
  }

  if (storage.accessMethod === 'local') {
    const scanRoot = resolveLocalBrowsePath(storage, task.path)

    if (!isLocalPathInside(sourcePath, scanRoot)) {
      throw new Error('源文件不在任务扫描目录内，已拒绝删除')
    }

    return
  }

  if (!isRemotePathInside(sourcePath, task.path)) {
    throw new Error('源文件不在任务扫描目录内，已拒绝删除')
  }
}

async function resolveWebhookDeletionSource(resolution, storages) {
  if (resolution.error) {
    throw new Error(resolution.error)
  }

  const storageId = resolution.task?.storageId || resolution.indexEntry?.storageId
  const storage = storages.find((item) => item.id === storageId)

  if (!storage) {
    throw new Error('未找到 STRM 对应的存储')
  }

  let sourcePath = resolution.indexEntry?.sourcePath ?? ''
  let sourceUrl = resolution.indexEntry?.sourceUrl ?? ''

  if (!sourcePath && resolution.strmFile && (await pathExists(resolution.strmFile))) {
    sourceUrl = await readStrmTarget(resolution.strmFile)
    sourcePath = getStorageSourcePathFromTarget(storage, sourceUrl)
  }

  if (!sourcePath && sourceUrl) {
    sourcePath = getStorageSourcePathFromTarget(storage, sourceUrl)
  }

  if (!sourcePath) {
    throw new Error('无法从 STRM 内容或索引反解源文件')
  }

  assertSourceInsideTask(storage, resolution.task, sourcePath)

  return {
    sourcePath,
    sourceUrl,
    storage,
  }
}

async function deleteOpenListSource(storage, sourcePath, dryRun) {
  const endpoint = normalizeEndpoint(storage.endpoint)
  const token = String(storage.openlist?.token ?? '').trim()
  const normalizedPath = normalizeRemotePath(sourcePath)
  const name = path.posix.basename(normalizedPath)
  const dir = path.posix.dirname(normalizedPath) || '/'

  if (!endpoint || !token) {
    throw new Error('OpenList / Alist 存储缺少服务地址或 Token')
  }

  if (dryRun) {
    return
  }

  await requestOpenListApi(endpoint, '/api/fs/remove', token, {
    body: JSON.stringify({
      dir,
      names: [name],
    }),
    method: 'POST',
  })
}

async function deleteWebDavSource(storage, sourcePath, dryRun) {
  const endpoint = normalizeEndpoint(storage.endpoint)

  if (!endpoint) {
    throw new Error('WebDAV 缺少地址')
  }

  if (dryRun) {
    return
  }

  const headers = {}
  const username = String(storage.webdav?.username ?? '').trim()
  const password = String(storage.webdav?.password ?? '').trim()

  if (username || password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  }

  const response = await fetch(joinEndpointAndPath(endpoint, sourcePath), {
    headers,
    method: 'DELETE',
  })

  if (!response.ok && response.status !== 404) {
    throw new Error(`WebDAV 删除失败: HTTP ${response.status}`)
  }
}

async function deleteLocalSource(sourcePath, dryRun) {
  if (dryRun) {
    return
  }

  try {
    await unlink(sourcePath)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

async function deleteWebhookSource(storage, sourcePath, dryRun) {
  if (storage.accessMethod === 'openlist') {
    await deleteOpenListSource(storage, sourcePath, dryRun)
    return
  }

  if (storage.accessMethod === 'webdav') {
    await deleteWebDavSource(storage, sourcePath, dryRun)
    return
  }

  if (storage.accessMethod === 'local') {
    await deleteLocalSource(sourcePath, dryRun)
    return
  }

  throw new Error(`不支持删除的接入方式：${storage.accessMethod}`)
}

async function handleWebhookPayload(route, payload) {
  const [settings, tasks, storages, indexEntries] = await Promise.all([
    readSettings(),
    readTasks(),
    readStorages(),
    readStrmIndex(),
  ])
  const expectedToken = getWebhookTokenFromSettings(settings)

  if (!expectedToken || route.token !== expectedToken) {
    throw createHttpError(403, 'Webhook token 无效', 'Webhook token 无效或已刷新')
  }

  if (settings.webhook?.embyDeleteSync === false) {
    return {
      ok: true,
      skipped: true,
      title: 'Emby 删除同步未启用',
    }
  }

  if (!isDeleteWebhookPayload(payload)) {
    return {
      ok: true,
      skipped: true,
      title: '忽略非删除事件',
    }
  }

  const strmCandidates = collectDirectCandidates(payload).filter(isStrmPathCandidate)

  if (strmCandidates.length === 0) {
    return {
      ok: false,
      results: [],
      title: '未找到 STRM 路径',
    }
  }

  const results = []
  const deletedStrmFiles = []

  for (const candidate of strmCandidates) {
    try {
      const resolution = await resolveWebhookStrmCandidate(candidate, tasks, settings, indexEntries)
      const deletionSource = await resolveWebhookDeletionSource(resolution, storages)

      await deleteWebhookSource(deletionSource.storage, deletionSource.sourcePath, route.dryRun)

      if (!route.dryRun && resolution.strmFile) {
        deletedStrmFiles.push(resolution.strmFile)
      }

      results.push({
        candidate,
        dryRun: route.dryRun,
        ok: true,
        sourcePath: deletionSource.sourcePath,
        storage: deletionSource.storage.name,
        storageId: deletionSource.storage.id,
        strmFile: resolution.strmFile,
      })
    } catch (error) {
      results.push({
        candidate,
        message: getErrorMessage(error),
        ok: false,
      })
    }
  }

  if (!route.dryRun) {
    await removeStrmIndexEntriesByFiles(deletedStrmFiles)
  }

  return {
    dryRun: route.dryRun,
    ok: results.every((result) => result.ok),
    results,
    title: route.dryRun ? 'Webhook dry-run 完成' : 'Webhook 删除同步完成',
  }
}

async function proxyToEmbyOrigin(mediaServerUrl, request, response) {
  const targetUrl = getEmbyProxyTargetUrl(mediaServerUrl, request.url)
  const headers = filterProxyHeaders(request.headers)
  const init = {
    headers,
    method: request.method,
    redirect: 'manual',
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request
    init.duplex = 'half'
  }

  const upstream = await fetch(targetUrl, init)
  const responseHeaders = {}

  upstream.headers.forEach((value, name) => {
    if (!hopByHopHeaders.has(name.toLowerCase())) {
      responseHeaders[name] = value
    }
  })

  response.writeHead(upstream.status, responseHeaders)

  if (request.method === 'HEAD' || !upstream.body) {
    response.end()
    return
  }

  Readable.fromWeb(upstream.body).pipe(response)
}

// Legacy Node proxy implementation kept as a fallback reference; runtime now delegates Emby proxying to go-emby2openlist.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleEmbyProxyRequest(request, response) {
  const settings = await readSettings()
  const proxySettings = settings.proxy302

  if (proxySettings.enabled === false) {
    sendProxyText(response, 503, 'OpenStrmBridge 302 代理未启用', '请在系统设置中启用代理。')
    return
  }

  const mediaServerUrl = normalizeEndpoint(proxySettings.mediaServerUrl)

  if (!mediaServerUrl) {
    sendProxyText(
      response,
      503,
      'OpenStrmBridge 302 代理未配置 Emby 地址',
      '请在系统设置的 302代理 中填写 Emby 服务地址。',
    )
    return
  }

  try {
    const directUrl = await resolveEmbyDirectPlaybackUrl(mediaServerUrl, request)

    if (directUrl) {
      redirectTo(response, directUrl)
      return
    }

    await proxyToEmbyOrigin(mediaServerUrl, request, response)
  } catch (error) {
    console.error(`Emby proxy request failed: ${getErrorMessage(error)}`)
    sendProxyText(response, 502, 'OpenStrmBridge 302 代理请求失败', getErrorMessage(error))
  }
}

async function closeEmbyProxyServer() {
  await stopGe2oProxyProcess()

  if (!embyProxyServer) {
    return
  }

  await new Promise((resolve, reject) => {
    embyProxyServer.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })

  embyProxyServer = null
}

async function syncEmbyProxyServer(proxySettings) {
  if (proxySettings?.enabled === false) {
    await closeEmbyProxyServer()
    return
  }

  await closeEmbyProxyServer()
  const [settings, storages] = await Promise.all([readSettings(), readStorages()])
  await startGe2oProxyProcess(
    {
      ...settings,
      proxy302: {
        ...settings.proxy302,
        ...proxySettings,
      },
    },
    storages,
  )
}

const staticContentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function sendStaticBuffer(response, request, filePath, content) {
  response.writeHead(200, {
    'Cache-Control':
      path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000',
    'Content-Length': content.byteLength,
    'Content-Type':
      staticContentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
  })

  if (request.method === 'HEAD') {
    response.end()
  } else {
    response.end(content)
  }
}

function normalizeRuntimeConfig(config) {
  const normalized = {}
  const apiBaseUrl = String(config?.apiBaseUrl ?? '').trim()
  const username = String(config?.auth?.username ?? '').trim()
  const password = config?.auth?.password
  const revision = String(config?.auth?.revision ?? '').trim()

  if (apiBaseUrl) {
    normalized.apiBaseUrl = apiBaseUrl
  }

  if (username && password !== undefined) {
    normalized.auth = {
      password: String(password),
      username,
    }

    if (revision) {
      normalized.auth.revision = revision
    }
  }

  return normalized
}

async function readRuntimeConfig() {
  let fileConfig = {}

  try {
    fileConfig = JSON.parse(await readFile(runtimeConfigFile, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`Unable to read runtime config: ${error.message}`)
    }
  }

  const envUsername = process.env.OPENSTRMBRIDGE_LOGIN_USER?.trim()
  const envPassword = process.env.OPENSTRMBRIDGE_LOGIN_PASSWORD
  const envRevision = process.env.OPENSTRMBRIDGE_AUTH_REVISION?.trim()
  const envApiBaseUrl = process.env.OPENSTRMBRIDGE_API_BASE_URL?.trim()
  const envConfig = {}

  if (envApiBaseUrl) {
    envConfig.apiBaseUrl = envApiBaseUrl
  }

  if (envUsername && envPassword !== undefined) {
    envConfig.auth = {
      password: envPassword,
      revision: envRevision,
      username: envUsername,
    }
  }

  return normalizeRuntimeConfig({
    ...envConfig,
    ...fileConfig,
    auth: {
      ...envConfig.auth,
      ...fileConfig.auth,
    },
  })
}

async function serveRuntimeConfig(request, response) {
  const runtimeConfig = await readRuntimeConfig()
  const content = Buffer.from(
    `window.__OPENSTRMBRIDGE_RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};\n`,
    'utf8',
  )

  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Length': content.byteLength,
    'Content-Type': 'text/javascript; charset=utf-8',
  })

  if (request.method === 'HEAD') {
    response.end()
  } else {
    response.end(content)
  }
}

async function getStaticFilePath(requestUrl) {
  const url = new URL(requestUrl, `http://127.0.0.1:${port}`)
  const pathname = safeDecodePathname(url.pathname)
  const hasFileExtension = Boolean(path.extname(pathname))
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const candidatePath = path.resolve(webDir, relativePath)
  const relativeToWebDir = path.relative(webDir, candidatePath)

  if (relativeToWebDir.startsWith('..') || path.isAbsolute(relativeToWebDir)) {
    return undefined
  }

  try {
    const candidateStat = await stat(candidatePath)

    if (candidateStat.isFile()) {
      return candidatePath
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }

  if (hasFileExtension) {
    return undefined
  }

  const indexPath = path.join(webDir, 'index.html')
  return (await pathExists(indexPath)) ? indexPath : undefined
}

async function serveStaticWeb(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false
  }

  const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname

  if (pathname.startsWith('/api/')) {
    return false
  }

  if (pathname === '/openstrmbridge-runtime-config.js') {
    await serveRuntimeConfig(request, response)
    return true
  }

  const filePath = await getStaticFilePath(request.url)

  if (!filePath) {
    return false
  }

  sendStaticBuffer(response, request, filePath, await readFile(filePath))
  return true
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    getOpenListDirectRoute(request.url)
  ) {
    await redirectOpenListDirectLink(request, response)
    return
  }

  const webhookRoute = request.method === 'POST' ? getWebhookRoute(request.url) : undefined

  if (webhookRoute) {
    try {
      const payload = await readJsonBody(request)
      sendJson(response, 200, await handleWebhookPayload(webhookRoute, payload))
    } catch (error) {
      sendJson(response, error.statusCode ?? 400, {
        ok: false,
        title: error.title ?? 'Webhook 处理失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'GET' && request.url === '/api/health') {
    sendJson(response, 200, { ok: true, service: 'openstrmbridge-storage-check' })
    return
  }

  if (request.method === 'GET' && request.url === '/api/settings') {
    try {
      const settings = await readSettings(getRequestOrigin(request))
      settings.proxy302 = {
        ...settings.proxy302,
        ...getGe2oRuntimeStatus(settings.proxy302),
      }
      sendJson(response, 200, settings)
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        title: '读取设置失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (
    request.method === 'GET' &&
    (request.url === '/api/strm-assistant' || request.url === '/api/emby-plugin')
  ) {
    try {
      const baseUrl = getRequestOrigin(request)
      sendJson(response, 200, {
        ...(await getEmbyPluginDefaults(baseUrl)),
        status: await getEmbyPluginStatus(baseUrl),
      })
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        title: '读取 Emby 插件状态失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'PUT' && request.url === '/api/strm-assistant/directory') {
    try {
      const values = await readJsonBody(request)
      sendJson(response, 200, await updateEmbyPluginDirectory(values, getRequestOrigin(request)))
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '保存 Emby 插件目录失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'PUT' && request.url === '/api/strm-assistant/task-schedule') {
    try {
      const values = await readJsonBody(request)
      sendJson(
        response,
        200,
        await updateStrmAssistantTaskSchedule(values, getRequestOrigin(request)),
      )
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '保存神医助手计划任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  const strmAssistantRunRoute = new URL(
    request.url || '/',
    'http://openstrmbridge.local',
  ).pathname.match(/^\/api\/strm-assistant\/task-runs\/([^/]+)$/)

  if (strmAssistantRunRoute && request.method === 'POST') {
    try {
      sendJson(
        response,
        200,
        await runStrmAssistantTaskOnce(
          decodeURIComponent(strmAssistantRunRoute[1]),
          getRequestOrigin(request),
        ),
      )
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '执行神医助手计划任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (strmAssistantRunRoute && request.method === 'GET') {
    try {
      sendJson(
        response,
        200,
        await getStrmAssistantTaskRun(
          decodeURIComponent(strmAssistantRunRoute[1]),
          getRequestOrigin(request),
        ),
      )
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '读取神医助手计划任务进度失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/strm-assistant/start') {
    try {
      sendJson(response, 200, await startStrmAssistant(getRequestOrigin(request)))
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '启动神医助手失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/emby-plugin/install') {
    try {
      sendJson(response, 200, await installEmbyPlugin(getRequestOrigin(request)))
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '安装 Emby 插件失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'PUT' && request.url === '/api/settings/strm') {
    try {
      const values = await readJsonBody(request)
      sendJson(
        response,
        200,
        await updateSettingsSection('strm', values, getRequestOrigin(request)),
      )
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '保存 STRM 设置失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'PUT' && request.url === '/api/settings/proxy302') {
    try {
      const values = await readJsonBody(request)
      const savedSettings = await updateSettingsSection(
        'proxy302',
        values,
        getRequestOrigin(request),
      )
      await syncEmbyProxyServer(savedSettings)
      sendJson(response, 200, {
        ...savedSettings,
        ...getGe2oRuntimeStatus(savedSettings),
      })
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '保存 302 代理设置失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'PUT' && request.url === '/api/settings/emby') {
    try {
      const values = await readJsonBody(request)
      sendJson(
        response,
        200,
        await updateSettingsSection(
          'emby',
          normalizeEmbySettings(values),
          getRequestOrigin(request),
        ),
      )
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '保存 Emby 授权失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'PUT' && request.url === '/api/settings/webhook') {
    try {
      const values = await readJsonBody(request)
      sendJson(
        response,
        200,
        await updateSettingsSection('webhook', values, getRequestOrigin(request)),
      )
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '保存 Webhook 设置失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'GET' && request.url === '/api/tasks') {
    try {
      sendJson(response, 200, await readTasksForClient())
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        title: '读取任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/tasks/run-all') {
    try {
      sendJson(response, 200, await runAllTasks())
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '运行全部任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  const taskRoute = getTaskRoute(request.url)

  if (request.method === 'PUT' && taskRoute && !taskRoute.action) {
    try {
      const task = await readJsonBody(request)
      const savedTask = await upsertTask({
        ...task,
        id: taskRoute.taskId,
      })
      sendJson(response, 200, savedTask)
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '保存任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'DELETE' && taskRoute && !taskRoute.action) {
    try {
      const deleted = await deleteTask(taskRoute.taskId)
      sendJson(response, 200, { ok: true, deleted })
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '删除任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && taskRoute?.action === 'run') {
    try {
      sendJson(response, 200, await runTask(taskRoute.taskId))
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '运行任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && taskRoute?.action === 'stop') {
    try {
      sendJson(response, 200, await stopTask(taskRoute.taskId))
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '停止任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'GET' && taskRoute?.action === 'log') {
    try {
      const tasks = await readTasks()
      const task = tasks.find((item) => item.id === taskRoute.taskId)

      if (!task) {
        throw new Error('未找到任务记录')
      }

      const runtimeLog = taskRuntimeLogs.get(task.id)

      sendJson(response, 200, {
        log: runtimeLog?.log ?? task.lastLog ?? '',
        status: runtimeLog?.status ?? task.status,
        taskId: task.id,
        taskName: task.name,
        updatedAt: runtimeLog?.updatedAt ?? task.lastRunAt,
      })
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '读取任务日志失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'GET' && request.url === '/api/storage') {
    try {
      sendJson(response, 200, await readStorages())
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        title: '读取存储失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'PUT' && getStorageIdFromPath(request.url)) {
    try {
      const storageId = getStorageIdFromPath(request.url)
      const storage = await readJsonBody(request)
      const savedStorage = await upsertStorage({
        ...storage,
        id: storageId,
      })
      sendJson(response, 200, savedStorage)
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '保存存储失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'DELETE' && getStorageIdFromPath(request.url)) {
    try {
      const storageId = getStorageIdFromPath(request.url)
      const deleted = await deleteStorage(storageId)
      sendJson(response, 200, { ok: true, deleted })
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '删除存储失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/storage/check') {
    try {
      const payload = await readJsonBody(request)
      const result = await checkStorage(payload)
      sendJson(response, 200, result)
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '检查请求失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/storage/browse') {
    try {
      const payload = await readJsonBody(request)
      const result = await browseStorage(payload)
      sendJson(response, 200, result)
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '目录读取失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (await serveStaticWeb(request, response)) {
    return
  }

  sendJson(response, 404, {
    ok: false,
    title: 'Not Found',
    message: '接口不存在',
  })
})

server.listen(port, host, () => {
  console.log(`OpenStrmBridge storage check server listening on http://${host}:${port}`)
  startTaskScheduler()
})

readSettings()
  .then((settings) => syncEmbyProxyServer(settings.proxy302))
  .catch((error) => {
    console.error(
      `OpenStrmBridge go-emby2openlist proxy failed to start: ${getErrorMessage(error)}`,
    )
  })
