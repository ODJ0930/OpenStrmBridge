import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import {
  formatSeasonDirectory,
  formatSeriesTitle,
  getLowerExtension,
  getRenameExtensionSets,
  isMediaFileName,
  isSidecarFileName,
  isValidRenameBasename,
  normalizeAiClassification,
  normalizeComparableTitle,
  normalizeNamingStyle,
  normalizeSeriesMetadata,
  parseAiJsonContent,
  renderEpisodeFileName,
  renderFolderName,
  renderMovieFileName,
  renderSidecarFileName,
} from './ai-rename-core.mjs'

const DEFAULT_PORT = 5174
const legacyAiRenamePromptTemplate = [
  '你是电视剧媒体库命名分析器。请仅依据现有目录名和文件名识别剧集信息。',
  '识别正式中文名、英文或原始标题、首播年份、季号、集号、多集编号、版本号和分段标记。',
  '目录季号与文件季号冲突时，以多数视频文件中可验证的季集信息为准。',
  '广告图片、网站宣传文件、发布组与画质编码信息应忽略；无法可靠识别的条目不要猜测。',
  '字幕、NFO、海报等附属文件只在能可靠关联视频时标记。',
].join('\n')
const televisionOnlyAiRenamePromptTemplate = [
  '你是电视剧媒体库命名分析器。请仅依据现有目录名和文件名识别剧集信息。',
  '识别正式简体中文名、官方或通用英文名、首播年份、季号、集号、多集编号、版本号和分段标记。',
  'titleOriginal 必须填英文名，不要填韩文、日文或其他原始语种标题；无法确认英文名时才使用可靠的罗马字转写。',
  '输出元数据将由后端固定整理为 Emby 电视剧结构：“剧集显示名 (首播年份)/Season 01/剧集显示名 - S01E01.ext”。',
  '特别篇使用 Season 00 和 S00E01；多集文件使用 S01E01-E02；集号和季号必须用数字字段返回。',
  '目录季号与文件季号冲突时，以多数视频文件中可验证的季集信息为准。',
  '广告图片、网站宣传文件、发布组与画质编码信息应忽略；无法可靠识别的条目不要猜测。',
  '字幕、NFO、海报等附属文件只在能可靠关联视频时标记。',
].join('\n')
const defaultAiRenamePromptTemplate = [
  '你是电影与电视剧媒体库命名分析器。请仅依据现有目录名和文件名识别媒体信息。',
  '先判断每个顶层目录是电视剧、单部电影还是电影合集，再识别正式简体中文名、官方或通用英文名、年份、季集号、版本号和分段标记。',
  'titleOriginal 必须填英文名，不要填韩文、日文或其他原始语种标题；无法确认英文名时才使用可靠的罗马字转写。',
  '电视剧由后端整理为 Emby 结构：“剧集显示名 (首播年份)/Season 01/剧集显示名 - S01E01.ext”。',
  '电影由后端整理为 Emby 结构：“电影显示名 (年份)/电影显示名 (年份).ext”；同一目录含多部续集时，每个视频必须分别返回自己的片名和年份。',
  '特别篇使用 Season 00 和 S00E01；多集文件使用 S01E01-E02；集号和季号必须用数字字段返回。',
  '不要把“速度与激情1-9”这类电影合集当成一季九集；仅在文件明确属于电视剧并有 SxxEyy、第x集等证据时才使用 episode。',
  '目录季号与文件季号冲突时，以多数视频文件中可验证的季集信息为准。',
  '广告图片、网站宣传文件、发布组与画质编码信息应忽略；无法可靠识别的条目不要猜测。',
  '字幕、NFO、海报等附属文件只在能可靠关联视频时标记。',
].join('\n')
const port = Number.parseInt(process.env.OPENSTRMBRIDGE_BACKEND_PORT ?? '', 10) || DEFAULT_PORT
const host = process.env.OPENSTRMBRIDGE_BACKEND_HOST?.trim() || '127.0.0.1'
const dataDir = process.env.OPENSTRMBRIDGE_DATA_DIR ?? path.join(process.cwd(), 'data')
const webDir = process.env.OPENSTRMBRIDGE_WEB_DIR?.trim() || path.join(process.cwd(), 'dist')
const settingsFile = path.join(dataDir, 'settings.json')
const storagesFile = path.join(dataDir, 'storages.json')
const tasksFile = path.join(dataDir, 'tasks.json')
const aiRenameTasksFile = path.join(dataDir, 'ai-rename-tasks.json')
const aiRenameIncrementalStateFile = path.join(dataDir, 'ai-rename-incremental-state.json')
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

const strmAssistantPluginSettingDefinitions = {
  'auto-merge-version': {
    defaultValue: false,
    path: ['ExperienceEnhanceOptions', 'MergeMultiVersion'],
    type: 'boolean',
  },
  'catchup-mode': {
    defaultValue: false,
    path: ['GeneralOptions', 'CatchupMode'],
    type: 'boolean',
  },
  'episode-refresh-days': {
    defaultValue: 365,
    max: 3650,
    min: 1,
    path: ['MetadataEnhanceOptions', 'EpisodeRefreshLookbackDays'],
    type: 'number',
  },
  'extract-workers': {
    defaultValue: 1,
    max: 20,
    min: 1,
    path: ['GeneralOptions', 'MaxConcurrentCount'],
    type: 'number',
  },
  'include-episodes-extras': {
    defaultValue: false,
    path: ['MediaInfoExtractOptions', 'IncludeExtra'],
    type: 'boolean',
  },
  'local-workers': {
    defaultValue: 1,
    max: 20,
    min: 1,
    path: ['GeneralOptions', 'Tier2MaxConcurrentCount'],
    type: 'number',
  },
  'native-intro-enhance': {
    defaultValue: false,
    path: ['IntroSkipOptions', 'UnlockIntroSkip'],
    type: 'boolean',
  },
  'play-session-intro': {
    defaultValue: false,
    path: ['IntroSkipOptions', 'EnableIntroSkip'],
    type: 'boolean',
  },
  'preview-thumbnail-enhance': {
    defaultValue: false,
    path: ['MediaInfoExtractOptions', 'EnableImageCapture'],
    type: 'boolean',
  },
  'single-thread-delay': {
    defaultValue: 0,
    max: 60,
    min: 0,
    path: ['GeneralOptions', 'CooldownDurationSeconds'],
    type: 'number',
  },
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

const configuredScanDirectoryLimit = Number.parseInt(
  process.env.OPENSTRMBRIDGE_SCAN_DIRECTORY_LIMIT ?? '',
  10,
)
const configuredScanMediaFileLimit = Number.parseInt(
  process.env.OPENSTRMBRIDGE_SCAN_MEDIA_FILE_LIMIT ?? '',
  10,
)
const scanLimits = {
  directories:
    Number.isFinite(configuredScanDirectoryLimit) && configuredScanDirectoryLimit > 0
      ? configuredScanDirectoryLimit
      : 2000,
  mediaFiles:
    Number.isFinite(configuredScanMediaFileLimit) && configuredScanMediaFileLimit > 0
      ? configuredScanMediaFileLimit
      : 5000,
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OpenStrmBridge-Api-Key',
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

function createApiAccessKey() {
  return `osb_${createSecret(32)}`
}

function getRequestOrigin(request) {
  const origin = request.headers.origin

  if (origin) {
    return origin
  }

  const host = request.headers.host
  return host ? `http://${host}` : ''
}

function getRequestHostOrigin(request) {
  const forwardedHost = getHeaderValue(request.headers['x-forwarded-host'])
    .split(',')
    .map((value) => value.trim())
    .find(Boolean)
  const hostHeader = forwardedHost || getHeaderValue(request.headers.host).trim()

  if (!hostHeader) {
    return ''
  }

  const forwardedProto = getHeaderValue(request.headers['x-forwarded-proto'])
    .split(',')
    .map((value) => value.trim())
    .find(Boolean)
  const proto = forwardedProto || 'http'

  return `${proto}://${hostHeader}`
}

function normalizeOrigin(value) {
  const rawValue = String(value ?? '').trim()

  if (!rawValue) {
    return ''
  }

  try {
    const url = new URL(rawValue)
    return `${url.protocol}//${url.host}`
  } catch {
    return ''
  }
}

function getRefererOrigin(request) {
  return normalizeOrigin(getHeaderValue(request.headers.referer))
}

function getOriginHeader(request) {
  return normalizeOrigin(getHeaderValue(request.headers.origin))
}

function getTrustedUiOrigins(request, settings = {}) {
  const origins = new Set(
    [
      getRequestHostOrigin(request),
      settings.strm?.baseUrl,
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'http://[::1]:5173',
      ...String(process.env.OPENSTRMBRIDGE_UI_ORIGINS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ]
      .map(normalizeOrigin)
      .filter(Boolean),
  )

  return origins
}

function isTrustedUiRequest(request, settings = {}) {
  const secFetchSite = getHeaderValue(request.headers['sec-fetch-site']).toLowerCase()

  if (secFetchSite === 'same-origin') {
    return true
  }

  const trustedOrigins = getTrustedUiOrigins(request, settings)
  const requestOrigins = [getOriginHeader(request), getRefererOrigin(request)].filter(Boolean)

  return requestOrigins.some((origin) => trustedOrigins.has(origin))
}

function getApiAccessKeyFromRequest(request) {
  const authorization = getHeaderValue(request.headers.authorization).trim()
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i)

  if (bearerMatch?.[1]) {
    return bearerMatch[1].trim()
  }

  return getHeaderValue(request.headers['x-openstrmbridge-api-key']).trim()
}

function isApiAccessKeyValid(providedKey, expectedKey) {
  const provided = String(providedKey ?? '')
  const expected = String(expectedKey ?? '')

  if (!provided || !expected) {
    return false
  }

  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  )
}

function isProtectedManagementApiRequest(request) {
  const pathname = new URL(request.url || '/', `http://127.0.0.1:${port}`).pathname

  if (!pathname.startsWith('/api/')) {
    return false
  }

  return !(
    pathname === '/api/health' ||
    pathname.startsWith('/api/strm/redirect/') ||
    pathname.startsWith('/api/openlist/direct/')
  )
}

async function requireApiAccessIfExternal(request, response) {
  if (!isProtectedManagementApiRequest(request)) {
    return false
  }

  const settings = await readSettings(getRequestOrigin(request))

  if (isTrustedUiRequest(request, settings)) {
    return false
  }

  if (settings.apiAccess?.enabled === false) {
    sendJson(response, 403, {
      ok: false,
      title: 'API 接口已关闭',
      message: 'API 接口当前处于关闭状态，请先在 OpenStrmBridge 管理台中开启。',
    })
    return true
  }

  if (isApiAccessKeyValid(getApiAccessKeyFromRequest(request), settings.apiAccess?.key)) {
    return false
  }

  sendJson(response, 401, {
    ok: false,
    title: 'API 秘钥无效',
    message:
      '外部调用 OpenStrmBridge 管理接口需要提供 Authorization: Bearer <key> 或 X-OpenStrmBridge-Api-Key。',
  })
  return true
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

function normalizeStrmThreadCount(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)

  if (!Number.isFinite(parsed)) {
    return 1
  }

  return Math.max(1, Math.min(64, parsed))
}

function normalizeApiAccessSettings(apiAccess = {}) {
  const now = new Date().toISOString()
  const key = String(apiAccess?.key ?? '').trim() || createApiAccessKey()
  const createdAt = String(apiAccess?.createdAt ?? '').trim() || now

  return {
    createdAt,
    enabled: apiAccess?.enabled !== false,
    key,
    updatedAt: String(apiAccess?.updatedAt ?? '').trim() || createdAt,
  }
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

const protectedAiRenameParameterNames = new Set([
  '__proto__',
  'constructor',
  'messages',
  'model',
  'prototype',
  'response_format',
  'stream',
])

function parseAiRenameCustomParameters(value, options = {}) {
  const strict = options.strict === true
  let parsed = value

  if (typeof value === 'string') {
    const text = value.trim() || '{}'

    if (text.length > 10000) {
      if (strict) {
        throw new Error('AI 自定义参数不能超过 10000 个字符')
      }

      return {}
    }

    try {
      parsed = JSON.parse(text)
    } catch {
      if (strict) {
        throw new Error('AI 自定义参数必须是有效的 JSON 对象')
      }

      return {}
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (strict) {
      throw new Error('AI 自定义参数必须是 JSON 对象，不能是数组或其他类型')
    }

    return {}
  }

  if (JSON.stringify(parsed).length > 10000) {
    if (strict) {
      throw new Error('AI 自定义参数不能超过 10000 个字符')
    }

    return {}
  }

  const normalized = {}

  for (const [key, parameterValue] of Object.entries(parsed)) {
    if (protectedAiRenameParameterNames.has(key)) {
      if (strict) {
        throw new Error(`AI 自定义参数不能覆盖受保护字段：${key}`)
      }

      continue
    }

    normalized[key] = parameterValue
  }

  return normalized
}

function formatAiRenameCustomParameters(value) {
  return JSON.stringify(parseAiRenameCustomParameters(value), null, 2)
}

function normalizeAiRenameSettings(aiRenameSettings = {}) {
  const baseUrl = normalizeEndpoint(
    aiRenameSettings.baseUrl || aiRenameSettings.apiBaseUrl || 'https://api.openai.com/v1',
  )
  const tmdbBaseUrl = normalizeEndpoint(
    aiRenameSettings.tmdbBaseUrl || 'https://api.themoviedb.org/3',
  )

  const configuredPrompt = String(aiRenameSettings.promptTemplate ?? '').trim()

  return {
    apiKey: String(aiRenameSettings.apiKey ?? '').trim(),
    baseUrl,
    customParameters: formatAiRenameCustomParameters(aiRenameSettings.customParameters),
    model: String(aiRenameSettings.model ?? '').trim(),
    namingStyle: normalizeNamingStyle(aiRenameSettings.namingStyle),
    promptTemplate:
      !configuredPrompt ||
      [legacyAiRenamePromptTemplate, televisionOnlyAiRenamePromptTemplate].includes(
        configuredPrompt,
      )
        ? defaultAiRenamePromptTemplate
        : configuredPrompt,
    rebuildFolders: aiRenameSettings.rebuildFolders === true,
    tmdbBaseUrl,
    tmdbEnabled: aiRenameSettings.tmdbEnabled === true,
    tmdbLanguage: String(aiRenameSettings.tmdbLanguage ?? 'zh-CN').trim() || 'zh-CN',
    tmdbToken: String(aiRenameSettings.tmdbToken ?? '').trim(),
  }
}

function getAiRenameSettingsForClient(aiRenameSettings = {}) {
  const normalized = normalizeAiRenameSettings(aiRenameSettings)

  return {
    apiKeyConfigured: Boolean(normalized.apiKey),
    baseUrl: normalized.baseUrl,
    customParameters: normalized.customParameters,
    model: normalized.model,
    namingStyle: normalized.namingStyle,
    promptTemplate: normalized.promptTemplate,
    rebuildFolders: normalized.rebuildFolders,
    tmdbBaseUrl: normalized.tmdbBaseUrl,
    tmdbEnabled: normalized.tmdbEnabled,
    tmdbLanguage: normalized.tmdbLanguage,
    tmdbTokenConfigured: Boolean(normalized.tmdbToken),
  }
}

function createDefaultSettings(baseUrl = '') {
  const normalizedBaseUrl = normalizeEndpoint(baseUrl)
  const webhookToken = createSecret(12)

  return {
    aiRename: normalizeAiRenameSettings(),
    apiAccess: normalizeApiAccessSettings(),
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
      threadCount: 1,
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
    aiRename: normalizeAiRenameSettings({
      ...defaults.aiRename,
      ...settings?.aiRename,
    }),
    apiAccess: normalizeApiAccessSettings(settings?.apiAccess ?? defaults.apiAccess),
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
      threadCount: normalizeStrmThreadCount(
        settings?.strm?.threadCount ?? defaults.strm.threadCount,
      ),
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
    return mergeSettings(await readRawSettings(), baseUrl)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return mergeSettings(undefined, baseUrl)
    }

    throw error
  }
}

async function readRawSettings() {
  const content = await readFile(settingsFile, 'utf8')
  return JSON.parse(content)
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

async function ensureApiAccessKey(baseUrl = '') {
  await ensureDataDir()

  let rawSettings

  try {
    rawSettings = await readRawSettings()
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }

  const settings = mergeSettings(rawSettings, baseUrl)
  const existingKey = String(rawSettings?.apiAccess?.key ?? '').trim()

  if (!existingKey) {
    await writeSettings(settings)
  }

  return settings.apiAccess
}

async function regenerateApiAccessKey(baseUrl = '') {
  const currentSettings = await readSettings(baseUrl)
  const now = new Date().toISOString()
  const nextSettings = mergeSettings(
    {
      ...currentSettings,
      apiAccess: {
        ...currentSettings.apiAccess,
        key: createApiAccessKey(),
        updatedAt: now,
      },
    },
    baseUrl,
  )

  await writeSettings(nextSettings)
  return nextSettings.apiAccess
}

async function updateApiAccessSettings(values = {}, baseUrl = '') {
  const currentSettings = await readSettings(baseUrl)
  const now = new Date().toISOString()
  const nextSettings = mergeSettings(
    {
      ...currentSettings,
      apiAccess: {
        ...currentSettings.apiAccess,
        enabled: values.enabled !== false,
        updatedAt: now,
      },
    },
    baseUrl,
  )

  await writeSettings(nextSettings)
  return nextSettings.apiAccess
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

async function readAiRenameTasks() {
  await ensureDataDir()

  try {
    const content = await readFile(aiRenameTasksFile, 'utf8')
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function writeAiRenameTasks(tasks) {
  await ensureDataDir()
  await writeFile(`${aiRenameTasksFile}.tmp`, JSON.stringify(tasks, null, 2), 'utf8')
  await rename(`${aiRenameTasksFile}.tmp`, aiRenameTasksFile)
}

let aiRenameIncrementalStateMutationQueue = Promise.resolve()

async function readAiRenameIncrementalState() {
  await ensureDataDir()

  try {
    const content = await readFile(aiRenameIncrementalStateFile, 'utf8')
    const parsed = JSON.parse(content)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

async function writeAiRenameIncrementalState(state) {
  await ensureDataDir()
  await writeFile(`${aiRenameIncrementalStateFile}.tmp`, JSON.stringify(state, null, 2), 'utf8')
  await rename(`${aiRenameIncrementalStateFile}.tmp`, aiRenameIncrementalStateFile)
}

function mutateAiRenameIncrementalState(mutator) {
  const mutation = aiRenameIncrementalStateMutationQueue.then(async () => {
    const currentState = await readAiRenameIncrementalState()
    const nextState = await mutator(currentState)
    await writeAiRenameIncrementalState(nextState)
    return nextState
  })

  aiRenameIncrementalStateMutationQueue = mutation.catch(() => undefined)
  return mutation
}

async function saveAiRenameIncrementalTaskState(taskId, taskState) {
  return mutateAiRenameIncrementalState((currentState) => ({
    ...currentState,
    [taskId]: taskState,
  }))
}

async function deleteAiRenameIncrementalTaskState(taskId) {
  return mutateAiRenameIncrementalState((currentState) => {
    const nextState = { ...currentState }
    delete nextState[taskId]
    return nextState
  })
}

function getManagedAiRenameIncrementalStateKey(taskId) {
  return `ai-rename-task:${String(taskId ?? '').trim()}`
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

let strmIndexMutationQueue = Promise.resolve()

function mutateStrmIndex(mutator) {
  const operation = strmIndexMutationQueue.then(async () => {
    const currentEntries = await readStrmIndex()
    const nextEntries = await mutator(currentEntries)
    await writeStrmIndex(nextEntries)
    return nextEntries
  })

  strmIndexMutationQueue = operation.catch(() => undefined)
  return operation
}

async function upsertStrmIndexEntries(entries) {
  if (!entries.length) {
    return
  }

  await mutateStrmIndex((currentEntries) => {
    const entriesByFile = new Map(
      currentEntries
        .filter((entry) => entry?.strmFile)
        .map((entry) => [path.resolve(String(entry.strmFile)), entry]),
    )

    for (const entry of entries.map(normalizeStrmIndexEntry)) {
      entriesByFile.set(entry.strmFile, entry)
    }

    return [...entriesByFile.values()]
  })
}

async function replaceStrmIndexEntriesForTask(taskId, entries) {
  const normalizedTaskId = String(taskId ?? '')
  const normalizedEntries = entries.map(normalizeStrmIndexEntry)

  await mutateStrmIndex((currentEntries) => {
    const entriesByFile = new Map(
      currentEntries
        .filter((entry) => String(entry?.taskId ?? '') !== normalizedTaskId && entry?.strmFile)
        .map((entry) => [path.resolve(String(entry.strmFile)), entry]),
    )

    for (const entry of normalizedEntries) {
      entriesByFile.set(entry.strmFile, entry)
    }

    return [...entriesByFile.values()]
  })
}

async function removeStrmIndexEntriesByFiles(strmFiles) {
  const files = new Set(strmFiles.filter(Boolean).map((file) => path.resolve(String(file))))

  if (files.size === 0) {
    return
  }

  await mutateStrmIndex((currentEntries) =>
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
  if (
    status === 'running' ||
    status === 'failed' ||
    status === 'partial' ||
    status === 'succeeded'
  ) {
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
    aiRenameBeforeStrm: firstBoolean(
      false,
      task.aiRenameBeforeStrm,
      task.aiRenameFirst,
      task.preAiRename,
    ),
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
  await deleteAiRenameIncrementalTaskState(taskId).catch(() => undefined)
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

function getStrmRedirectRoute(url) {
  const pathname = new URL(url, 'http://localhost').pathname
  const match = pathname.match(/^\/api\/strm\/redirect\/([^/]+)(?:\/(.*))?$/)

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
  const attempts = Number.isFinite(init.retryAttempts) ? Math.max(1, init.retryAttempts) : 3
  const requestInit = { ...init }
  delete requestInit.retryAttempts
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}${apiPath}`, {
        ...requestInit,
        headers: {
          Authorization: token,
          ...(requestInit.body ? { 'Content-Type': 'application/json' } : {}),
          ...requestInit.headers,
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

async function listAllOpenListEntries(storage, browsePath) {
  const endpoint = normalizeEndpoint(storage.endpoint)
  const token = String(storage.openlist?.token ?? '').trim()

  if (!endpoint || !token) {
    throw new Error('OpenList / Alist 存储缺少服务地址或 Token')
  }

  const currentPath = normalizeRemotePath(
    browsePath || storage.openlist?.basePath || storage.rootPath,
  )
  const entries = []
  const perPage = 500
  let page = 1

  while (true) {
    const list = await requestOpenListApi(endpoint, '/api/fs/list', token, {
      body: JSON.stringify({
        page,
        password: '',
        path: currentPath,
        per_page: perPage,
        refresh: false,
      }),
      method: 'POST',
    })
    const content = Array.isArray(list?.content) ? list.content : []

    for (const entry of content) {
      const name = String(entry.name ?? '').trim() || '(未命名)'
      const kind = entry.is_dir ? 'folder' : 'file'

      entries.push({
        id: `${kind}:${joinRemotePath(currentPath, name)}`,
        kind,
        name,
        path: joinRemotePath(currentPath, name),
        size: entry.size,
        updatedAt: entry.modified,
      })
    }

    const total = Number.parseInt(String(list?.total ?? ''), 10)

    if (content.length < perPage || (Number.isFinite(total) && entries.length >= total)) {
      break
    }

    page += 1
  }

  return {
    entries: sortEntries(entries),
    path: currentPath,
  }
}

async function listAllLocalEntries(storage, browsePath) {
  const currentPath = resolveLocalBrowsePath(storage, browsePath)
  const dirents = await readdir(currentPath, { withFileTypes: true })
  const entries = await Promise.all(
    dirents.map(async (dirent) => {
      const entryPath = path.join(currentPath, dirent.name)
      const entryStat = await stat(entryPath)
      const kind = dirent.isDirectory() ? 'folder' : 'file'

      return {
        id: `${kind}:${entryPath}`,
        kind,
        name: dirent.name,
        path: entryPath,
        size: entryStat.size,
        updatedAt: entryStat.mtime.toISOString(),
      }
    }),
  )

  return {
    entries: sortEntries(entries),
    path: currentPath,
  }
}

async function listAllStorageEntries(storage, currentPath) {
  if (storage.accessMethod === 'openlist') {
    return listAllOpenListEntries(storage, currentPath)
  }

  if (storage.accessMethod === 'webdav') {
    return browseWebDav(storage, currentPath)
  }

  if (storage.accessMethod === 'local') {
    return listAllLocalEntries(storage, currentPath)
  }

  throw new Error(`不支持的接入方式：${storage.accessMethod}`)
}

function getStorageConfiguredRoot(storage) {
  if (storage.accessMethod === 'local') {
    const configuredRoot = String(
      storage.local?.path ?? storage.rootPath ?? storage.endpoint ?? '',
    ).trim()

    if (!configuredRoot) {
      throw new Error('本地文件缺少目录路径')
    }

    return path.resolve(configuredRoot)
  }

  if (storage.accessMethod === 'openlist') {
    return normalizeStoragePath(storage, storage.openlist?.basePath || storage.rootPath || '/')
  }

  return normalizeStoragePath(storage, storage.rootPath || '/')
}

function normalizeStoragePath(storage, candidatePath) {
  return storage.accessMethod === 'local'
    ? path.resolve(String(candidatePath ?? ''))
    : normalizeRemotePath(path.posix.normalize(normalizeRemotePath(candidatePath)))
}

function joinStoragePath(storage, basePath, name) {
  return storage.accessMethod === 'local'
    ? path.join(basePath, name)
    : normalizeRemotePath(path.posix.join(normalizeRemotePath(basePath), name))
}

function getStoragePathName(storage, candidatePath) {
  return storage.accessMethod === 'local'
    ? path.basename(candidatePath)
    : path.posix.basename(normalizeRemotePath(candidatePath))
}

function getStorageParentPath(storage, candidatePath) {
  if (storage.accessMethod === 'local') {
    return path.dirname(candidatePath)
  }

  const parentPath = path.posix.dirname(normalizeRemotePath(candidatePath))
  return parentPath || '/'
}

function storagePathsEqual(storage, firstPath, secondPath) {
  const first = normalizeStoragePath(storage, firstPath)
  const second = normalizeStoragePath(storage, secondPath)

  return storage.accessMethod === 'local' && process.platform === 'win32'
    ? first.toLocaleLowerCase() === second.toLocaleLowerCase()
    : first === second
}

function getStoragePathStateKey(storage, candidatePath) {
  const normalized = normalizeStoragePath(storage, candidatePath)
  return storage.accessMethod === 'local' && process.platform === 'win32'
    ? normalized.toLocaleLowerCase()
    : normalized
}

function storagePathStateHas(pathState, storage, candidatePath) {
  return pathState?.has(getStoragePathStateKey(storage, candidatePath)) === true
}

function addStoragePathState(pathState, storage, candidatePath) {
  const normalized = normalizeStoragePath(storage, candidatePath)
  pathState?.set(getStoragePathStateKey(storage, normalized), normalized)
}

function deleteStoragePathState(pathState, storage, candidatePath) {
  pathState?.delete(getStoragePathStateKey(storage, candidatePath))
}

function moveStoragePathState(pathState, storage, sourcePath, targetPath) {
  if (!pathState) {
    return
  }

  const normalizedSource = normalizeStoragePath(storage, sourcePath)
  const normalizedTarget = normalizeStoragePath(storage, targetPath)
  const affectedPaths = [...pathState.values()].filter((candidatePath) =>
    storage.accessMethod === 'local'
      ? isLocalPathInside(candidatePath, normalizedSource)
      : isRemotePathInside(candidatePath, normalizedSource),
  )

  for (const candidatePath of affectedPaths) {
    const relativePath =
      storage.accessMethod === 'local'
        ? path.relative(normalizedSource, candidatePath)
        : path.posix.relative(normalizedSource, candidatePath)
    const nextPath = relativePath
      ? storage.accessMethod === 'local'
        ? path.join(normalizedTarget, relativePath)
        : normalizeRemotePath(path.posix.join(normalizedTarget, relativePath))
      : normalizedTarget
    deleteStoragePathState(pathState, storage, candidatePath)
    addStoragePathState(pathState, storage, nextPath)
  }
}

function assertStoragePathInside(storage, candidatePath, operationRoot) {
  const configuredRoot = getStorageConfiguredRoot(storage)
  const normalizedCandidate = normalizeStoragePath(storage, candidatePath)
  const normalizedOperationRoot = normalizeStoragePath(storage, operationRoot)

  if (storage.accessMethod === 'local') {
    if (
      !isLocalPathInside(normalizedOperationRoot, configuredRoot) ||
      !isLocalPathInside(normalizedCandidate, configuredRoot) ||
      !isLocalPathInside(normalizedCandidate, normalizedOperationRoot)
    ) {
      throw new Error('本地源路径或目标路径超出存储根目录')
    }

    return normalizedCandidate
  }

  if (
    !isRemotePathInside(normalizedOperationRoot, configuredRoot) ||
    !isRemotePathInside(normalizedCandidate, configuredRoot) ||
    !isRemotePathInside(normalizedCandidate, normalizedOperationRoot)
  ) {
    throw new Error('远程源路径或目标路径超出存储根目录')
  }

  return normalizedCandidate
}

function getWebDavAuthHeaders(storage) {
  const headers = {}
  const username = String(storage.webdav?.username ?? '').trim()
  const password = String(storage.webdav?.password ?? '').trim()

  if (username || password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  }

  return headers
}

async function storageEntryExists(storage, candidatePath) {
  if (storage.accessMethod === 'local') {
    return pathExists(candidatePath)
  }

  if (storage.accessMethod === 'openlist') {
    const endpoint = normalizeEndpoint(storage.endpoint)
    const token = String(storage.openlist?.token ?? '').trim()

    try {
      await requestOpenListApi(endpoint, '/api/fs/get', token, {
        body: JSON.stringify({ password: '', path: normalizeRemotePath(candidatePath) }),
        method: 'POST',
        retryAttempts: 1,
      })
      return true
    } catch (error) {
      if (/HTTP 404|not found|object not found/i.test(String(error?.message ?? ''))) {
        return false
      }

      throw error
    }
  }

  let response = await fetch(joinEndpointAndPath(storage.endpoint, candidatePath), {
    headers: getWebDavAuthHeaders(storage),
    method: 'HEAD',
  })

  if (response.status === 405) {
    response = await fetch(joinEndpointAndPath(storage.endpoint, candidatePath), {
      body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
      headers: {
        ...getWebDavAuthHeaders(storage),
        Depth: '0',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      method: 'PROPFIND',
    })
  }

  if (response.status === 404) {
    return false
  }

  if (!response.ok) {
    throw new Error(`WebDAV 路径检查失败: HTTP ${response.status}`)
  }

  return true
}

async function createStorageDirectory(storage, directoryPath) {
  if (storage.accessMethod === 'local') {
    await mkdir(directoryPath, { recursive: true })
    return
  }

  if (storage.accessMethod === 'openlist') {
    await requestOpenListApi(
      normalizeEndpoint(storage.endpoint),
      '/api/fs/mkdir',
      String(storage.openlist?.token ?? '').trim(),
      {
        body: JSON.stringify({ path: normalizeRemotePath(directoryPath) }),
        method: 'POST',
      },
    )
    return
  }

  const response = await fetch(joinEndpointAndPath(storage.endpoint, directoryPath), {
    headers: getWebDavAuthHeaders(storage),
    method: 'MKCOL',
  })

  if (!response.ok && response.status !== 405) {
    throw new Error(`WebDAV 创建目录失败: HTTP ${response.status}`)
  }
}

async function ensureStorageDirectory(storage, directoryPath, operationRoot, pathState) {
  const normalizedTarget = assertStoragePathInside(storage, directoryPath, operationRoot)

  if (
    storagePathStateHas(pathState, storage, normalizedTarget) ||
    (!pathState && (await storageEntryExists(storage, normalizedTarget)))
  ) {
    return
  }

  const parentPath = getStorageParentPath(storage, normalizedTarget)

  if (
    !storagePathsEqual(storage, parentPath, normalizedTarget) &&
    !storagePathsEqual(storage, parentPath, operationRoot)
  ) {
    await ensureStorageDirectory(storage, parentPath, operationRoot, pathState)
  }

  await createStorageDirectory(storage, normalizedTarget)
  addStoragePathState(pathState, storage, normalizedTarget)
}

async function moveWebDavEntry(storage, sourcePath, targetPath) {
  const destination = joinEndpointAndPath(storage.endpoint, targetPath)
  const response = await fetch(joinEndpointAndPath(storage.endpoint, sourcePath), {
    headers: {
      ...getWebDavAuthHeaders(storage),
      Destination: destination,
      Overwrite: 'F',
    },
    method: 'MOVE',
  })

  if (!response.ok) {
    throw new Error(`WebDAV 移动或重命名失败: HTTP ${response.status}`)
  }
}

async function renameStorageEntry(storage, sourcePath, newName) {
  if (!isValidRenameBasename(newName)) {
    throw new Error(`无效的新名称：${newName || '(空)'}`)
  }

  const targetPath = joinStoragePath(storage, getStorageParentPath(storage, sourcePath), newName)

  if (storage.accessMethod === 'local') {
    await rename(sourcePath, targetPath)
    return targetPath
  }

  if (storage.accessMethod === 'openlist') {
    await requestOpenListApi(
      normalizeEndpoint(storage.endpoint),
      '/api/fs/rename',
      String(storage.openlist?.token ?? '').trim(),
      {
        body: JSON.stringify({
          name: newName,
          overwrite: false,
          path: normalizeRemotePath(sourcePath),
        }),
        method: 'POST',
      },
    )
    return targetPath
  }

  await moveWebDavEntry(storage, sourcePath, targetPath)
  return targetPath
}

async function moveStorageEntry(storage, sourcePath, destinationDirectory) {
  const name = getStoragePathName(storage, sourcePath)
  const targetPath = joinStoragePath(storage, destinationDirectory, name)

  if (storage.accessMethod === 'local') {
    await rename(sourcePath, targetPath)
    return targetPath
  }

  if (storage.accessMethod === 'openlist') {
    await requestOpenListApi(
      normalizeEndpoint(storage.endpoint),
      '/api/fs/move',
      String(storage.openlist?.token ?? '').trim(),
      {
        body: JSON.stringify({
          dst_dir: normalizeRemotePath(destinationDirectory),
          names: [name],
          overwrite: false,
          src_dir: normalizeRemotePath(getStorageParentPath(storage, sourcePath)),
        }),
        method: 'POST',
      },
    )
    return targetPath
  }

  await moveWebDavEntry(storage, sourcePath, targetPath)
  return targetPath
}

const aiRenameJobs = new Map()
const activeAiRenameJobsByStorage = new Map()

function getAiRenameChatCompletionsUrl(baseUrl) {
  const normalized = normalizeEndpoint(baseUrl)

  if (!normalized) {
    throw new Error('请先配置 AI Base URL')
  }

  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

function getAiRenameModelsUrl(baseUrl) {
  const normalized = normalizeEndpoint(baseUrl)

  if (!normalized) {
    throw new Error('请先配置 AI Base URL')
  }

  if (normalized.endsWith('/chat/completions')) {
    return `${normalized.slice(0, -'/chat/completions'.length)}/models`
  }

  return normalized.endsWith('/models') ? normalized : `${normalized}/models`
}

function getChatMessageContent(payload) {
  const content = payload?.choices?.[0]?.message?.content

  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === 'string' ? item : String(item?.text ?? '')))
      .join('')
  }

  return String(content ?? '')
}

async function requestAiChatCompletion(aiSettings, messages, options = {}) {
  const apiKey = String(aiSettings.apiKey ?? '').trim()
  const model = String(aiSettings.model ?? '').trim()

  if (!apiKey) {
    throw new Error('请先配置 AI API Key')
  }

  if (!model) {
    throw new Error('请先配置 AI 模型')
  }

  const requestUrl = getAiRenameChatCompletionsUrl(aiSettings.baseUrl)
  const customParameters = parseAiRenameCustomParameters(aiSettings.customParameters)
  const requestWithJsonMode = async (jsonMode) => {
    let lastError

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (options.signal?.aborted) {
        throw new Error('AI 重命名任务已取消')
      }

      try {
        const response = await fetch(requestUrl, {
          body: JSON.stringify({
            temperature: 0.1,
            ...customParameters,
            messages,
            model,
            stream: false,
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          }),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          signal: options.signal,
        })
        const text = await response.text()
        let payload

        try {
          payload = text ? JSON.parse(text) : {}
        } catch {
          payload = {}
        }

        if (response.ok) {
          const content = getChatMessageContent(payload)

          if (!content) {
            throw new Error('AI 接口未返回 choices[0].message.content')
          }

          return options.includeMetadata ? { content, payload } : content
        }

        const errorMessage = String(
          payload?.error?.message || payload?.message || text || `HTTP ${response.status}`,
        ).slice(0, 800)
        const error = new Error(`AI 接口请求失败: ${errorMessage}`)
        error.statusCode = response.status
        lastError = error

        if (response.status !== 429 && response.status < 500) {
          throw error
        }
      } catch (error) {
        if (options.signal?.aborted) {
          throw new Error('AI 重命名任务已取消')
        }

        lastError = error

        if (error?.statusCode && error.statusCode !== 429 && error.statusCode < 500) {
          throw error
        }
      }

      if (attempt < 3) {
        await sleep(400 * attempt)
      }
    }

    throw lastError
  }

  try {
    return await requestWithJsonMode(true)
  } catch (error) {
    if (error?.statusCode !== 400 && !/response.?format|json.?mode/i.test(error?.message ?? '')) {
      throw error
    }

    return requestWithJsonMode(false)
  }
}

function resolveAiRenameSettingsValues(currentSettings, values = {}) {
  const current = normalizeAiRenameSettings(currentSettings)
  const clearApiKey = values.clearApiKey === true
  const clearTmdbToken = values.clearTmdbToken === true
  const providedApiKey = String(values.apiKey ?? '').trim()
  const providedTmdbToken = String(values.tmdbToken ?? '').trim()

  if (Object.hasOwn(values, 'customParameters')) {
    parseAiRenameCustomParameters(values.customParameters, { strict: true })
  }

  return normalizeAiRenameSettings({
    ...current,
    ...values,
    apiKey: clearApiKey ? '' : providedApiKey || current.apiKey,
    tmdbToken: clearTmdbToken ? '' : providedTmdbToken || current.tmdbToken,
  })
}

async function saveAiRenameSettings(values, baseUrl = '') {
  const settings = await readSettings(baseUrl)
  const aiRename = resolveAiRenameSettingsValues(settings.aiRename, values)
  await updateSettingsSection('aiRename', aiRename, baseUrl)
  return getAiRenameSettingsForClient(aiRename)
}

async function discoverAiRenameModels(values, baseUrl = '') {
  const settings = await readSettings(baseUrl)
  const aiRename = resolveAiRenameSettingsValues(settings.aiRename, values)

  if (!aiRename.apiKey) {
    throw new Error('请先配置 AI API Key')
  }

  const response = await fetch(getAiRenameModelsUrl(aiRename.baseUrl), {
    headers: { Authorization: `Bearer ${aiRename.apiKey}` },
  })
  const text = await response.text()
  let payload

  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = {}
  }

  if (!response.ok) {
    const message = String(
      payload?.error?.message || payload?.message || text || `HTTP ${response.status}`,
    ).slice(0, 800)
    const error = new Error(`AI 模型探测失败: ${message}`)
    error.statusCode = response.status
    throw error
  }

  const sourceModels = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : []
  const models = [
    ...new Map(
      sourceModels
        .map((item) => {
          if (typeof item === 'string') {
            return { id: item.trim(), ownedBy: '' }
          }

          return {
            id: String(item?.id || item?.name || '').trim(),
            ownedBy: String(item?.owned_by || item?.ownedBy || '').trim(),
          }
        })
        .filter((item) => item.id)
        .map((item) => [item.id, item]),
    ).values(),
  ].sort((first, second) => first.id.localeCompare(second.id, 'en'))

  if (models.length === 0) {
    throw new Error('接口已响应，但未返回可用模型；仍可手动输入模型名称')
  }

  return {
    count: models.length,
    message: `已探测到 ${models.length} 个模型`,
    models,
    ok: true,
  }
}

async function testAiRenameConnection(values, baseUrl = '') {
  const settings = await readSettings(baseUrl)
  const aiRename = resolveAiRenameSettingsValues(settings.aiRename, values)
  const startedAt = Date.now()
  const result = await requestAiChatCompletion(
    aiRename,
    [
      {
        content:
          'Return one JSON object only. It must be exactly {"ok":true,"service":"ai-rename","probe":"speed-test-0123456789"}.',
        role: 'user',
      },
    ],
    { includeMetadata: true },
  )
  const latencyMs = Math.max(1, Date.now() - startedAt)
  const content = result.content
  const parsed = parseAiJsonContent(content)

  if (parsed?.ok !== true) {
    throw new Error('AI 接口已响应，但未按要求返回 JSON')
  }

  const reportedCompletionTokens = Number(
    result.payload?.usage?.completion_tokens ?? result.payload?.usage?.output_tokens,
  )
  const tokenCountEstimated =
    !Number.isFinite(reportedCompletionTokens) || reportedCompletionTokens <= 0
  const completionTokens = tokenCountEstimated
    ? Math.max(1, Math.ceil(Array.from(content).length / 4))
    : reportedCompletionTokens
  const tokensPerSecond = Number((completionTokens / (latencyMs / 1000)).toFixed(2))

  return {
    message: 'AI 模型可用性测试通过',
    completionTokens,
    latencyMs,
    model: aiRename.model,
    ok: true,
    tokenCountEstimated,
    tokensPerSecond,
  }
}

async function testTmdbConnection(values, baseUrl = '') {
  const settings = await readSettings(baseUrl)
  const aiRename = resolveAiRenameSettingsValues(settings.aiRename, values)

  if (!aiRename.tmdbToken) {
    throw new Error('请先配置 TMDB Read Access Token')
  }

  const startedAt = Date.now()
  const response = await fetch(`${aiRename.tmdbBaseUrl}/configuration`, {
    headers: { Authorization: `Bearer ${aiRename.tmdbToken}` },
  })
  const latencyMs = Math.max(1, Date.now() - startedAt)

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`TMDB 连接失败: ${String(text || `HTTP ${response.status}`).slice(0, 800)}`)
  }

  return {
    latencyMs,
    message: 'TMDB 连接测试通过',
    ok: true,
  }
}

function getAiRenameJobRoute(requestUrl) {
  const pathname = new URL(requestUrl || '/', 'http://localhost').pathname
  const match = pathname.match(/^\/api\/storage\/ai-rename\/jobs\/([^/]+)(?:\/(cancel))?$/)

  if (!match) {
    return undefined
  }

  return {
    action: match[2] ?? '',
    jobId: decodeURIComponent(match[1]),
  }
}

function getAiRenameJobForClient(job) {
  return {
    allowMove: job.allowMove,
    createdAt: job.createdAt,
    currentPath: job.currentPath,
    finishedAt: job.finishedAt,
    id: job.id,
    incrementalInventory: job.incrementalInventory
      ? {
          baselineUpdated: job.incrementalInventory.baselineUpdated === true,
          inventoryGroups: job.incrementalInventory.inventoryGroups,
          submittedGroups: job.incrementalInventory.submittedGroups,
          unchangedGroups: job.incrementalInventory.unchangedGroups,
        }
      : undefined,
    message: job.message,
    path: job.path,
    progress: { ...job.progress },
    results: job.results.map((result) => ({ ...result })),
    stage: job.stage,
    startedAt: job.startedAt,
    status: job.status,
    storageId: job.storageId,
    taskId: job.taskId,
    useTmdb: job.useTmdb,
  }
}

function notifyAiRenameJobProgress(job, event) {
  try {
    job.onProgress?.(event)
  } catch {
    // Progress reporting must never interrupt a rename operation.
  }
}

function setAiRenameJobStage(job, stage, message) {
  job.stage = stage
  job.message = message
  notifyAiRenameJobProgress(job, { message, stage, type: 'stage' })
}

function appendAiRenameJobResult(job, result, countAs = '') {
  const jobResult = {
    at: new Date().toISOString(),
    ...result,
  }
  job.results.push(jobResult)
  notifyAiRenameJobProgress(job, { result: jobResult, type: 'result' })

  if (job.results.length > 2000) {
    job.results.splice(0, job.results.length - 2000)
  }

  if (countAs === 'succeeded') {
    job.progress.succeeded += 1
    job.progress.completedOperations += 1
  } else if (countAs === 'skipped') {
    job.progress.skipped += 1
    job.progress.completedOperations += 1
  } else if (countAs === 'failed') {
    job.progress.failed += 1
    job.progress.completedOperations += 1
  } else if (countAs === 'ignored') {
    job.progress.ignored += 1
    job.progress.completedOperations += 1
  }
}

function throwIfAiRenameCancelled(job) {
  if (job.cancelRequested || job.abortController.signal.aborted) {
    throw new Error('AI_RENAME_CANCELLED')
  }
}

function getRelativeStoragePath(storage, rootPath, candidatePath) {
  return storage.accessMethod === 'local'
    ? path.relative(rootPath, candidatePath).replaceAll('\\', '/')
    : path.posix.relative(normalizeRemotePath(rootPath), normalizeRemotePath(candidatePath))
}

async function scanAiRenameTree(storage, requestedPath, job, extensionSets) {
  const operationRoot = normalizeStoragePath(
    storage,
    storage.accessMethod === 'local'
      ? resolveLocalBrowsePath(storage, requestedPath)
      : normalizeRemotePath(requestedPath),
  )
  assertStoragePathInside(storage, operationRoot, operationRoot)

  const queue = [{ depth: 0, path: operationRoot, topId: '' }]
  const entries = []
  const pathState = new Map()
  addStoragePathState(pathState, storage, operationRoot)
  let idCounter = 0

  while (queue.length > 0) {
    throwIfAiRenameCancelled(job)
    const current = queue.shift()
    job.currentPath = current.path
    const result = await listAllStorageEntries(storage, current.path)

    for (const entry of result.entries) {
      throwIfAiRenameCancelled(job)
      assertStoragePathInside(storage, entry.path, operationRoot)
      idCounter += 1
      const id = `entry-${idCounter}`
      const depth = current.depth + 1
      const topId =
        current.depth === 0 ? (entry.kind === 'folder' ? id : '__root_files__') : current.topId
      const extension = getLowerExtension(entry.name)
      const scannedEntry = {
        depth,
        eligible:
          entry.kind === 'folder' ||
          isMediaFileName(entry.name, extensionSets) ||
          isSidecarFileName(entry.name, extensionSets),
        extension,
        id,
        kind: entry.kind,
        name: entry.name,
        path: entry.path,
        relativePath: getRelativeStoragePath(storage, operationRoot, entry.path),
        size: entry.kind === 'file' ? String(entry.size ?? '') : '',
        topId,
        updatedAt: entry.kind === 'file' ? String(entry.updatedAt ?? '') : '',
      }

      entries.push(scannedEntry)
      addStoragePathState(pathState, storage, entry.path)
      job.progress.scanned += 1

      if (entry.kind === 'folder') {
        queue.push({ depth, path: entry.path, topId })
      }
    }
  }

  job.currentPath = operationRoot
  return { entries, operationRoot, pathState }
}

function createAiRenameInventoryPrompt(
  groupRecords,
  rootNames,
  additionalInstructions,
  promptTemplate,
) {
  const inventory = groupRecords.map(({ groupEntries, groupId }) => ({
    directoryName: getTopEntryForPlan(groupEntries)?.name ?? '当前目录文件',
    directoryPath: getTopEntryForPlan(groupEntries)?.relativePath ?? '.',
    entries: groupEntries.map((entry) => ({
      depth: entry.depth,
      eligible: entry.eligible,
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      relativePath: entry.relativePath,
    })),
    groupId,
    mediaHint: inferAiRenameMediaHint(
      getTopEntryForPlan(groupEntries)?.path ?? groupEntries[0]?.path,
    ),
  }))

  return [
    String(promptTemplate || defaultAiRenamePromptTemplate).trim(),
    '你是电影与电视剧媒体库命名分析器。下方是一次性汇总的全部视频目录清单，需要在一次回复中完成所有目录的识别。只输出一个 JSON 对象，不要输出 Markdown。',
    '不要返回路径或 newName；后端会根据结构化字段生成安全名称。',
    '每组必须返回 mediaType，值只能是 tv、movie、movie-collection。电视剧使用 series；电影的 series 必须为 null，片名和年份写在每个 movie item 中。',
    '输出结构：{"groups":[{"groupId":"输入的 groupId","mediaType":"tv","series":{"titleZh":"简体中文正式名","titleOriginal":"官方或通用英文名","year":2013,"season":1},"items":[...]}]}。',
    'titleOriginal 是英文显示名字段，即使原始语种是韩文、日文或其他语言，也必须返回官方或通用英文名，不得返回非英文原名。',
    '后端会固定生成 Emby 标准名称。电视剧：“剧集显示名 (首播年份)/Season 01/剧集显示名 - S01E01.ext”；电影：“电影显示名 (年份)/电影显示名 (年份).ext”。',
    '每个输入 groupId 必须在 groups 中恰好返回一次；不得合并、拆分或遗漏目录。',
    'items 中每项必须使用输入 id。role 只能是 series-folder、season-folder、episode、collection-folder、movie-folder、movie、sidecar、poster、fanart、tvshow-nfo、season-nfo、season-poster、ignore。',
    'episode 项包含 season、episodes（数字数组），可选 version（如 v2）和 part。',
    'movie 项必须包含 titleZh、titleOriginal、year，可选 version（如 v2）、edition 和 part；movie-folder 使用 movieFor 指向对应 movie id。',
    'sidecar 项必须用 sidecarFor 指向对应 episode 或 movie id；字幕可提供 language、forced、hearingImpaired。',
    '每个 eligible 文件或文件夹都应返回一项；广告图片、网站宣传图、无法可靠识别项使用 ignore。',
    '顶层单季目录标为 season-folder；包含多个季目录的剧集容器标为 series-folder；子季目录标为 season-folder。',
    '单部电影目录标为 movie-folder；同一目录包含多部独立电影或续集时使用 movie-collection，容器标为 collection-folder，每个视频分别标为 movie。',
    '输入中的 mediaHint 来自用户选择的媒体库路径：movie 表示电影库，禁止返回 tv；tv 表示电视剧库。unknown 才允许完全自行判断。',
    '数字续集、年份、分辨率或文件排列序号本身不是电视剧集号。尤其是速度与激情、哈利波特等电影系列不得输出 S01E01；即使文件曾被错误命名为 S01E01，也要结合合集目录名按电影续集识别。',
    '必须结合文件内容纠正目录里的错误季号，例如目录写 S01、文件写 S06 时以文件为准。',
    `当前根目录的顶层名称：${JSON.stringify(rootNames)}`,
    additionalInstructions ? `用户补充说明：${additionalInstructions.slice(0, 2000)}` : '',
    `待识别媒体目录清单：${JSON.stringify(inventory)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function inferAiRenameMediaHint(storagePath) {
  const segments = String(storagePath ?? '')
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean)

  if (
    segments.some(
      (segment) =>
        segment.includes('电影') ||
        /^(?:movie|movies|film|films|cinema)(?:[-_\s].*)?$/.test(segment),
    )
  ) {
    return 'movie'
  }

  if (
    segments.some(
      (segment) =>
        segment.includes('电视剧') ||
        segment.includes('剧集') ||
        /^(?:tv|television|series|shows?)(?:[-_\s].*)?$/.test(segment),
    )
  ) {
    return 'tv'
  }

  return 'unknown'
}

function createAiRenameGroupRecords(entries, extensionSets) {
  const groupedEntries = new Map()

  for (const entry of entries) {
    const group = groupedEntries.get(entry.topId) ?? []
    group.push(entry)
    groupedEntries.set(entry.topId, group)
  }

  return [...groupedEntries.values()]
    .filter((group) =>
      group.some((entry) => entry.kind === 'file' && isMediaFileName(entry.name, extensionSets)),
    )
    .map((groupEntries) => ({
      fingerprint: createAiRenameGroupFingerprint(groupEntries),
      groupEntries,
      groupId: String(groupEntries[0]?.topId ?? ''),
      groupPath: getTopEntryForPlan(groupEntries)?.path ?? groupEntries[0]?.path ?? '',
    }))
}

function createAiRenameGroupFingerprint(groupEntries) {
  const inventory = groupEntries
    .map((entry) => ({
      eligible: entry.eligible === true,
      kind: entry.kind,
      name: entry.name,
      relativePath: String(entry.relativePath ?? '').replaceAll('\\', '/'),
      size: entry.kind === 'file' ? String(entry.size ?? '') : '',
      updatedAt: entry.kind === 'file' ? String(entry.updatedAt ?? '') : '',
    }))
    .sort((first, second) => {
      return (
        first.relativePath.localeCompare(second.relativePath) ||
        first.kind.localeCompare(second.kind) ||
        first.name.localeCompare(second.name)
      )
    })

  return createHash('sha256').update(JSON.stringify(inventory)).digest('hex')
}

function createAiRenameConfigurationFingerprint(aiSettings, taskOptions = {}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        baseUrl: aiSettings.baseUrl,
        customParameters: aiSettings.customParameters,
        model: aiSettings.model,
        namingStyle: aiSettings.namingStyle,
        promptTemplate: aiSettings.promptTemplate,
        rebuildFolders: aiSettings.rebuildFolders,
        tmdbBaseUrl: aiSettings.tmdbBaseUrl,
        tmdbEnabled: aiSettings.tmdbEnabled && Boolean(aiSettings.tmdbToken),
        tmdbLanguage: aiSettings.tmdbLanguage,
        taskOptions,
        version: 2,
      }),
    )
    .digest('hex')
}

async function classifyAiRenameInventory(aiSettings, groupRecords, rootNames, job, extraPrompt) {
  const content = await requestAiChatCompletion(
    aiSettings,
    [
      {
        content:
          'You classify movie and TV-series folders and files into structured metadata for a deterministic media-library renamer. Return JSON only.',
        role: 'system',
      },
      {
        content: createAiRenameInventoryPrompt(
          groupRecords,
          rootNames,
          extraPrompt,
          aiSettings.promptTemplate,
        ),
        role: 'user',
      },
    ],
    { signal: job.abortController.signal },
  )

  const payload = parseAiJsonContent(content)

  if (!Array.isArray(payload?.groups)) {
    throw new Error('AI 返回结构无效：缺少 groups 数组')
  }

  const expectedGroupIds = new Set(groupRecords.map((record) => record.groupId))
  const suggestions = new Map()

  for (const suggestion of payload.groups) {
    const groupId = String(suggestion?.groupId ?? '').trim()

    if (!groupId || !expectedGroupIds.has(groupId)) {
      continue
    }

    if (suggestions.has(groupId)) {
      suggestions.set(groupId, { error: `AI 重复返回目录 ${groupId}` })
      continue
    }

    suggestions.set(groupId, { payload: suggestion })
  }

  return suggestions
}

async function verifySeriesWithTmdb(series, aiSettings, job) {
  if (!aiSettings.tmdbEnabled || !aiSettings.tmdbToken) {
    return { series }
  }

  const query = series.titleOriginal || series.titleZh

  if (!query) {
    return { series, warning: 'TMDB 校验已跳过：缺少查询标题' }
  }

  const queryTitles = new Set(
    [series.titleZh, series.titleOriginal, query].map(normalizeComparableTitle).filter(Boolean),
  )
  const findUniqueMatches = (payload) => {
    const exactMatches = (Array.isArray(payload?.results) ? payload.results : []).filter(
      (candidate) => {
        const candidateTitles = [candidate.name, candidate.original_name]
          .map(normalizeComparableTitle)
          .filter(Boolean)
        const candidateYear = Number.parseInt(
          String(candidate.first_air_date ?? '').slice(0, 4),
          10,
        )
        const yearMatches =
          !series.year || !Number.isFinite(candidateYear) || candidateYear === series.year

        return yearMatches && candidateTitles.some((title) => queryTitles.has(title))
      },
    )

    return [...new Map(exactMatches.map((candidate) => [candidate.id, candidate])).values()]
  }
  const search = async (language) => {
    const searchUrl = new URL(`${aiSettings.tmdbBaseUrl}/search/tv`)
    searchUrl.searchParams.set('query', query)
    searchUrl.searchParams.set('language', language)
    searchUrl.searchParams.set('include_adult', 'false')

    if (series.year) {
      searchUrl.searchParams.set('first_air_date_year', String(series.year))
    }

    const response = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${aiSettings.tmdbToken}` },
      signal: job.abortController.signal,
    })

    return {
      payload: response.ok ? await response.json() : undefined,
      status: response.status,
    }
  }
  const localizedSearch = await search(aiSettings.tmdbLanguage)

  if (!localizedSearch.payload && aiSettings.tmdbLanguage.toLowerCase() === 'en-us') {
    return { series, warning: `TMDB 搜索失败: HTTP ${localizedSearch.status}` }
  }

  let uniqueMatches = findUniqueMatches(localizedSearch.payload)

  if (uniqueMatches.length !== 1 && aiSettings.tmdbLanguage.toLowerCase() !== 'en-us') {
    const englishSearch = await search('en-US')

    if (englishSearch.payload) {
      uniqueMatches = findUniqueMatches(englishSearch.payload)
    } else if (!localizedSearch.payload) {
      return { series, warning: `TMDB 搜索失败: HTTP ${englishSearch.status}` }
    }
  }

  if (uniqueMatches.length !== 1) {
    return {
      series,
      warning:
        uniqueMatches.length === 0
          ? `TMDB 未找到唯一匹配：${query}`
          : `TMDB 存在多个匹配，已保留 AI 结果：${query}`,
    }
  }

  const match = uniqueMatches[0]
  const fetchDetails = async (language) => {
    const response = await fetch(
      `${aiSettings.tmdbBaseUrl}/tv/${encodeURIComponent(match.id)}?language=${encodeURIComponent(language)}`,
      {
        headers: { Authorization: `Bearer ${aiSettings.tmdbToken}` },
        signal: job.abortController.signal,
      },
    )

    return response.ok ? response.json() : undefined
  }
  const details = (await fetchDetails(aiSettings.tmdbLanguage)) ?? match
  const englishDetails =
    aiSettings.tmdbLanguage.toLowerCase() === 'en-us'
      ? details
      : ((await fetchDetails('en-US')) ?? details)
  const titleOriginalCandidates = [
    englishDetails.name,
    series.titleOriginal,
    match.name,
    details.original_name,
    match.original_name,
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
  const englishTitle =
    titleOriginalCandidates.find((value) => /[A-Za-z]/.test(value)) ?? titleOriginalCandidates[0]
  const verified = normalizeSeriesMetadata({
    ...series,
    titleOriginal: englishTitle,
    titleZh: details.name || match.name || series.titleZh,
    year:
      Number.parseInt(
        String(details.first_air_date || match.first_air_date || '').slice(0, 4),
        10,
      ) || series.year,
  })

  return { series: verified }
}

function getTopEntryForPlan(entries) {
  return entries.find((entry) => entry.depth === 1 && entry.kind === 'folder')
}

function buildAiRenameGroupPlan(groupEntries, classification, extensionSets, operationRoot) {
  const entryById = new Map(groupEntries.map((entry) => [entry.id, entry]))
  const classifiedItems = classification.items.filter((item) => entryById.has(item.id))
  const itemById = new Map(classifiedItems.map((item) => [item.id, item]))
  const mediaNamesById = new Map()
  const operations = []
  const topEntry = getTopEntryForPlan(groupEntries)
  const topItem = topEntry ? itemById.get(topEntry.id) : undefined
  const isTelevision = classification.mediaType === 'tv'
  const movieItems = classifiedItems.filter((item) => item.role === 'movie')

  for (const item of classifiedItems) {
    const entry = entryById.get(item.id)

    if (
      entry?.kind !== 'file' ||
      (isTelevision ? item.role !== 'episode' : item.role !== 'movie') ||
      !isMediaFileName(entry.name, extensionSets)
    ) {
      continue
    }

    const newName = isTelevision
      ? renderEpisodeFileName(
          classification.series,
          {
            ...item,
            season: item.season ?? classification.series.season,
          },
          entry.name,
        )
      : renderMovieFileName(item, entry.name, classification.namingStyle)

    if (newName && isValidRenameBasename(newName)) {
      mediaNamesById.set(item.id, newName)
      operations.push({
        depth: entry.depth,
        entryId: entry.id,
        kind: 'file',
        newName,
        oldName: entry.name,
        sourcePath: entry.path,
        type: 'rename',
      })
    }
  }

  for (const item of classifiedItems) {
    const entry = entryById.get(item.id)

    if (
      !entry ||
      entry.kind !== 'file' ||
      item.role === 'episode' ||
      item.role === 'movie' ||
      item.role === 'ignore'
    ) {
      continue
    }

    if (!isSidecarFileName(entry.name, extensionSets)) {
      continue
    }

    const newName = renderSidecarFileName(
      classification.series,
      { ...item, season: item.season ?? classification.series.season },
      entry.name,
      mediaNamesById,
    )

    if (newName && isValidRenameBasename(newName)) {
      operations.push({
        depth: entry.depth,
        entryId: entry.id,
        kind: 'file',
        newName,
        oldName: entry.name,
        sourcePath: entry.path,
        type: 'rename',
      })
    }
  }

  for (const item of classifiedItems) {
    const entry = entryById.get(item.id)

    if (!entry || entry.kind !== 'folder' || item.role === 'ignore') {
      continue
    }

    let newName = ''

    if (isTelevision) {
      newName = renderFolderName(
        classification.series,
        { ...item, season: item.season ?? classification.series.season },
        entry.depth === 1,
      )
    } else if (item.role === 'movie-folder') {
      const linkedMovie = item.movieFor ? itemById.get(String(item.movieFor)) : undefined
      const movie =
        linkedMovie?.role === 'movie'
          ? linkedMovie
          : item.titleZh || item.titleOriginal
            ? item
            : movieItems.length === 1
              ? movieItems[0]
              : undefined

      if (movie) {
        newName = formatSeriesTitle({ ...movie, namingStyle: classification.namingStyle }, true)
      }
    }

    if (newName && isValidRenameBasename(newName)) {
      operations.push({
        depth: entry.depth,
        entryId: entry.id,
        isTopFolder: entry.id === topEntry?.id,
        kind: 'folder',
        newName,
        oldName: entry.name,
        sourcePath: entry.path,
        type: 'rename',
      })
    }
  }

  const nestedSeasonFolders = classifiedItems.filter((item) => {
    const entry = entryById.get(item.id)
    return entry?.kind === 'folder' && entry.depth > 1 && item.role === 'season-folder'
  })
  const topRole =
    topItem?.role ||
    (topEntry
      ? nestedSeasonFolders.length > 0
        ? 'series-folder'
        : classification.series.season !== undefined
          ? 'season-folder'
          : ''
      : '')
  const topSeason = topItem?.season ?? classification.series.season

  return {
    classification,
    entries: groupEntries,
    entryById,
    itemById,
    mediaType: classification.mediaType,
    operationRoot,
    operations,
    seriesKey: isTelevision
      ? `${normalizeComparableTitle(formatSeriesTitle(classification.series, false))}:${classification.series.year ?? ''}`
      : '',
    seriesTitle: isTelevision ? formatSeriesTitle(classification.series, true) : '',
    topEntry,
    topRole,
    topSeason,
  }
}

function markDuplicateRenameTargets(storage, plans) {
  const operationsByTarget = new Map()

  for (const plan of plans) {
    for (const operation of plan.operations) {
      const targetPath = joinStoragePath(
        storage,
        getStorageParentPath(storage, operation.sourcePath),
        operation.newName,
      )
      const normalizedTarget = normalizeStoragePath(storage, targetPath)
      const key =
        storage.accessMethod === 'local' && process.platform === 'win32'
          ? normalizedTarget.toLocaleLowerCase()
          : normalizedTarget
      const existing = operationsByTarget.get(key)

      if (existing && !storagePathsEqual(storage, existing.sourcePath, operation.sourcePath)) {
        existing.invalidReason = '多个条目生成了相同目标名称'
        operation.invalidReason = '多个条目生成了相同目标名称'
      } else {
        operationsByTarget.set(key, operation)
      }
    }
  }
}

async function executeAiRenameOperation(job, storage, operationRoot, operation) {
  throwIfAiRenameCancelled(job)
  job.currentPath = operation.sourcePath

  if (operation.invalidReason) {
    appendAiRenameJobResult(
      job,
      {
        action: operation.type,
        message: operation.invalidReason,
        oldPath: operation.sourcePath,
        status: 'skipped',
      },
      'skipped',
    )
    return ''
  }

  if (!isValidRenameBasename(operation.newName)) {
    appendAiRenameJobResult(
      job,
      {
        action: operation.type,
        message: 'AI 生成的名称未通过安全校验',
        oldPath: operation.sourcePath,
        status: 'skipped',
      },
      'skipped',
    )
    return ''
  }

  const sourcePath = assertStoragePathInside(storage, operation.sourcePath, operationRoot)
  const targetPath = assertStoragePathInside(
    storage,
    joinStoragePath(storage, getStorageParentPath(storage, sourcePath), operation.newName),
    operationRoot,
  )

  if (storagePathsEqual(storage, sourcePath, targetPath) && sourcePath === targetPath) {
    operation.currentPath = sourcePath
    appendAiRenameJobResult(
      job,
      {
        action: operation.type,
        message: '名称无需修改',
        oldPath: sourcePath,
        status: 'ignored',
      },
      'ignored',
    )
    return sourcePath
  }

  try {
    if (
      !storagePathStateHas(job.pathState, storage, sourcePath) &&
      !(await storageEntryExists(storage, sourcePath))
    ) {
      throw new Error('源条目已不存在')
    }

    const targetExists =
      storagePathStateHas(job.pathState, storage, targetPath) ||
      (!job.pathState && (await storageEntryExists(storage, targetPath)))
    const caseOnlyRename =
      sourcePath !== targetPath &&
      normalizeStoragePath(storage, sourcePath).toLocaleLowerCase() ===
        normalizeStoragePath(storage, targetPath).toLocaleLowerCase()

    if (targetExists && !caseOnlyRename) {
      appendAiRenameJobResult(
        job,
        {
          action: operation.type,
          message: '目标名称已存在，未执行覆盖',
          newPath: targetPath,
          oldPath: sourcePath,
          status: 'skipped',
        },
        'skipped',
      )
      return ''
    }

    let finalPath

    if (caseOnlyRename) {
      const temporaryName = `.openstrmbridge-ai-${createSecret(8)}`
      const temporaryPath = await renameStorageEntry(storage, sourcePath, temporaryName)

      try {
        finalPath = await renameStorageEntry(storage, temporaryPath, operation.newName)
      } catch (error) {
        await renameStorageEntry(
          storage,
          temporaryPath,
          getStoragePathName(storage, sourcePath),
        ).catch(() => undefined)
        throw error
      }
    } else {
      finalPath = await renameStorageEntry(storage, sourcePath, operation.newName)
    }

    operation.currentPath = finalPath
    moveStoragePathState(job.pathState, storage, sourcePath, finalPath)
    appendAiRenameJobResult(
      job,
      {
        action: operation.type,
        message: '重命名成功',
        newPath: finalPath,
        oldPath: sourcePath,
        status: 'succeeded',
      },
      'succeeded',
    )
    return finalPath
  } catch (error) {
    appendAiRenameJobResult(
      job,
      {
        action: operation.type,
        message: getErrorMessage(error),
        newPath: targetPath,
        oldPath: sourcePath,
        status: 'failed',
      },
      'failed',
    )
    return ''
  }
}

async function executeAiMovePlan(job, storage, plan) {
  throwIfAiRenameCancelled(job)

  if (!plan.topEntry || !plan.seriesTitle) {
    const rootEpisodeOperations = plan.operations.filter(
      (operation) => operation.kind === 'file' && operation.currentPath,
    )

    for (const operation of rootEpisodeOperations) {
      const item = plan.itemById.get(operation.entryId)
      const seasonName = formatSeasonDirectory(item?.season ?? plan.classification.series.season)

      if (!seasonName) {
        continue
      }

      const seriesDirectory = joinStoragePath(storage, plan.operationRoot, plan.seriesTitle)
      const seasonDirectory = joinStoragePath(storage, seriesDirectory, seasonName)
      const sourcePath = operation.currentPath
      const targetPath = joinStoragePath(
        storage,
        seasonDirectory,
        getStoragePathName(storage, sourcePath),
      )
      job.progress.totalOperations += 1

      try {
        assertStoragePathInside(storage, targetPath, plan.operationRoot)
        await ensureStorageDirectory(storage, seasonDirectory, plan.operationRoot, job.pathState)

        if (
          storagePathStateHas(job.pathState, storage, targetPath) ||
          (!job.pathState && (await storageEntryExists(storage, targetPath)))
        ) {
          appendAiRenameJobResult(
            job,
            {
              action: 'move',
              message: '目标季目录中已存在同名文件',
              newPath: targetPath,
              oldPath: sourcePath,
              status: 'skipped',
            },
            'skipped',
          )
          continue
        }

        const movedPath = await moveStorageEntry(storage, sourcePath, seasonDirectory)
        moveStoragePathState(job.pathState, storage, sourcePath, movedPath)
        appendAiRenameJobResult(
          job,
          {
            action: 'move',
            message: '文件已移动到标准季目录',
            newPath: movedPath,
            oldPath: sourcePath,
            status: 'succeeded',
          },
          'succeeded',
        )
      } catch (error) {
        appendAiRenameJobResult(
          job,
          {
            action: 'move',
            message: getErrorMessage(error),
            newPath: targetPath,
            oldPath: sourcePath,
            status: 'failed',
          },
          'failed',
        )
      }
    }

    return
  }

  const topSourcePath = plan.topEntry.path

  if (plan.topRole === 'season-folder') {
    job.progress.totalOperations += 1
    const seasonName = formatSeasonDirectory(plan.topSeason)
    const seriesDirectory = joinStoragePath(storage, plan.operationRoot, plan.seriesTitle)
    const finalSeasonPath = seasonName ? joinStoragePath(storage, seriesDirectory, seasonName) : ''

    if (!seasonName) {
      appendAiRenameJobResult(
        job,
        {
          action: 'move',
          message: '未识别出季号，无法创建标准季目录',
          oldPath: topSourcePath,
          status: 'skipped',
        },
        'skipped',
      )
      return
    }

    try {
      assertStoragePathInside(storage, finalSeasonPath, plan.operationRoot)

      if (
        storagePathStateHas(job.pathState, storage, finalSeasonPath) ||
        (!job.pathState && (await storageEntryExists(storage, finalSeasonPath)))
      ) {
        appendAiRenameJobResult(
          job,
          {
            action: 'move',
            message: '同一剧集的目标季目录已存在，已跳过重复季',
            newPath: finalSeasonPath,
            oldPath: topSourcePath,
            status: 'skipped',
          },
          'skipped',
        )
        return
      }

      await ensureStorageDirectory(storage, seriesDirectory, plan.operationRoot, job.pathState)
      const movedPath = await moveStorageEntry(storage, topSourcePath, seriesDirectory)
      moveStoragePathState(job.pathState, storage, topSourcePath, movedPath)
      const finalPath = await renameStorageEntry(storage, movedPath, seasonName)
      moveStoragePathState(job.pathState, storage, movedPath, finalPath)
      appendAiRenameJobResult(
        job,
        {
          action: 'move',
          message: '整季目录已归入标准剧集目录',
          newPath: finalPath,
          oldPath: topSourcePath,
          status: 'succeeded',
        },
        'succeeded',
      )
    } catch (error) {
      appendAiRenameJobResult(
        job,
        {
          action: 'move',
          message: getErrorMessage(error),
          newPath: finalSeasonPath,
          oldPath: topSourcePath,
          status: 'failed',
        },
        'failed',
      )
    }

    return
  }

  if (plan.topRole === 'series-folder') {
    const topOperation = plan.operations.find((operation) => operation.isTopFolder)

    if (topOperation) {
      job.progress.totalOperations += 1
      await executeAiRenameOperation(job, storage, plan.operationRoot, topOperation)
    }
  }
}

async function executeAiRenamePlan(job, storage, plan, allowMove, groupIndex, groupCount) {
  throwIfAiRenameCancelled(job)
  markDuplicateRenameTargets(storage, [plan])

  const operations = plan.operations.filter(
    (operation) => !(allowMove === true && plan.mediaType === 'tv' && operation.isTopFolder),
  )
  job.progress.totalOperations += operations.length
  setAiRenameJobStage(job, 'executing', `正在逐项修改第 ${groupIndex}/${groupCount} 个目录`)

  for (const operation of operations
    .filter((item) => item.kind === 'file')
    .sort((first, second) => second.depth - first.depth)) {
    await executeAiRenameOperation(job, storage, plan.operationRoot, operation)
  }

  for (const operation of operations
    .filter((item) => item.kind === 'folder')
    .sort((first, second) => second.depth - first.depth)) {
    await executeAiRenameOperation(job, storage, plan.operationRoot, operation)
  }

  if (allowMove === true && plan.mediaType === 'tv') {
    setAiRenameJobStage(job, 'moving', `正在整理第 ${groupIndex}/${groupCount} 个目录的标准季结构`)
    await executeAiMovePlan(job, storage, plan)
  }
}

async function runAiRenameJob(job, payload) {
  job.status = 'running'
  job.startedAt = new Date().toISOString()
  let settings
  let storage

  try {
    const storages = await readStorages()
    storage = storages.find((item) => item.id === payload.storageId)

    if (!storage) {
      throw new Error('未找到存储记录')
    }

    settings = await readSettings()
    const aiSettings = normalizeAiRenameSettings({
      ...settings.aiRename,
      tmdbEnabled: payload.useTmdb === true && settings.aiRename?.tmdbEnabled === true,
    })
    const extensionSets = getRenameExtensionSets(settings.strm)
    setAiRenameJobStage(job, 'scanning', '正在递归扫描目录')
    const { entries, operationRoot, pathState } = await scanAiRenameTree(
      storage,
      payload.path,
      job,
      extensionSets,
    )
    job.pathState = pathState
    throwIfAiRenameCancelled(job)

    const rootNames = entries.filter((entry) => entry.depth === 1).map((entry) => entry.name)
    const allGroupRecords = createAiRenameGroupRecords(entries, extensionSets).map((record) => ({
      ...record,
      groupPath: record.groupPath || operationRoot,
    }))
    const unchangedFingerprints = new Set(
      Array.isArray(payload.unchangedGroupFingerprints)
        ? payload.unchangedGroupFingerprints.map((fingerprint) => String(fingerprint))
        : [],
    )
    const groupRecords = allGroupRecords.filter(
      (record) => !unchangedFingerprints.has(record.fingerprint),
    )
    const unchangedGroupCount = allGroupRecords.length - groupRecords.length
    job.incrementalInventory = {
      currentFingerprints: allGroupRecords.map((record) => record.fingerprint),
      inventoryGroups: allGroupRecords.length,
      submittedGroups: groupRecords.length,
      unchangedGroups: unchangedGroupCount,
    }
    job.progress.inventoryGroups = allGroupRecords.length
    job.progress.unchangedGroups = unchangedGroupCount
    job.progress.totalGroups = groupRecords.length

    if (job.taskId && payload.incrementalBaselineMessage) {
      appendAiRenameJobResult(job, {
        action: 'inventory',
        message: String(payload.incrementalBaselineMessage),
        oldPath: operationRoot,
        status: payload.incrementalBaselineStatus === 'error' ? 'warning' : 'info',
      })
    }

    if (unchangedGroupCount > 0) {
      appendAiRenameJobResult(job, {
        action: 'inventory',
        message: `增量计算跳过 ${unchangedGroupCount} 个未变化目录，本次仅提交 ${groupRecords.length} 个变化目录`,
        oldPath: operationRoot,
        status: 'info',
      })
    }

    let suggestionsByGroup = new Map()

    if (groupRecords.length > 0) {
      const inventoryEntryCount = groupRecords.reduce(
        (total, record) => total + record.groupEntries.length,
        0,
      )
      job.currentPath = operationRoot
      setAiRenameJobStage(
        job,
        'analyzing',
        `正在一次性提交 ${groupRecords.length} 个视频目录给 AI 识别`,
      )
      appendAiRenameJobResult(job, {
        action: 'inventory',
        message: `已汇总 ${groupRecords.length} 个视频目录、${inventoryEntryCount} 个条目，正在进行一次性 AI 识别`,
        oldPath: operationRoot,
        status: 'info',
      })
      suggestionsByGroup = await classifyAiRenameInventory(
        aiSettings,
        groupRecords,
        rootNames,
        job,
        String(payload.extraPrompt ?? '').trim(),
      )
      throwIfAiRenameCancelled(job)
      appendAiRenameJobResult(job, {
        action: 'inventory',
        message: `AI 已一次性返回 ${suggestionsByGroup.size}/${groupRecords.length} 个目录的修改建议，开始按顺序执行`,
        oldPath: operationRoot,
        status: 'info',
      })
    } else if (allGroupRecords.length > 0) {
      appendAiRenameJobResult(job, {
        action: 'inventory',
        message: `增量计算确认 ${allGroupRecords.length} 个视频目录均未变化，本次未调用 AI`,
        oldPath: operationRoot,
        status: 'info',
      })
    } else {
      appendAiRenameJobResult(job, {
        action: 'inventory',
        message: '未扫描到可处理的视频目录，未调用 AI',
        oldPath: operationRoot,
        status: 'info',
      })
    }

    for (const [groupOffset, groupRecord] of groupRecords.entries()) {
      throwIfAiRenameCancelled(job)
      const groupIndex = groupOffset + 1
      const { groupEntries, groupId, groupPath } = groupRecord
      job.currentPath = groupPath
      setAiRenameJobStage(
        job,
        'executing',
        `AI 建议已返回，正在准备修改第 ${groupIndex}/${groupRecords.length} 个目录`,
      )
      appendAiRenameJobResult(job, {
        action: 'directory',
        message: `开始执行 AI 建议（${groupIndex}/${groupRecords.length}）`,
        oldPath: groupPath,
        status: 'info',
      })

      try {
        const suggestion = suggestionsByGroup.get(groupId)

        if (!suggestion) {
          throw new Error(`AI 未返回目录 ${groupId} 的修改建议`)
        }

        if (suggestion.error) {
          throw new Error(suggestion.error)
        }

        const classification = normalizeAiClassification(suggestion.payload)
        const mediaHint = inferAiRenameMediaHint(groupPath)

        if (mediaHint === 'movie' && classification.mediaType === 'tv') {
          throw new Error('AI 将电影目录识别为电视剧，已跳过以避免生成 SxxExx 名称')
        }

        classification.namingStyle = aiSettings.namingStyle
        classification.series.namingStyle = aiSettings.namingStyle
        const tmdbResult =
          classification.mediaType === 'tv'
            ? await verifySeriesWithTmdb(classification.series, aiSettings, job)
            : { series: classification.series }
        classification.series = tmdbResult.series
        job.progress.analyzed += groupEntries.length

        if (tmdbResult.warning) {
          appendAiRenameJobResult(job, {
            action: 'tmdb',
            message: tmdbResult.warning,
            oldPath: groupEntries[0]?.path,
            status: 'warning',
          })
        }

        const plan = buildAiRenameGroupPlan(
          groupEntries,
          classification,
          extensionSets,
          operationRoot,
        )

        if (plan.mediaType !== 'tv' || plan.seriesTitle) {
          await executeAiRenamePlan(
            job,
            storage,
            plan,
            payload.allowMove === true,
            groupIndex,
            groupRecords.length,
          )
          job.progress.processedGroups = groupIndex
          appendAiRenameJobResult(job, {
            action: 'directory',
            message: `目录处理完成（${groupIndex}/${groupRecords.length}），继续执行下一目录`,
            oldPath: groupPath,
            status: 'info',
          })
        } else {
          job.progress.totalOperations += 1
          appendAiRenameJobResult(
            job,
            {
              action: 'analyze',
              message: 'AI 未生成有效的媒体名称',
              oldPath: groupEntries[0]?.path,
              status: 'failed',
            },
            'failed',
          )
        }
      } catch (error) {
        if (job.cancelRequested || /AI_RENAME_CANCELLED|任务已取消/.test(error?.message ?? '')) {
          throw new Error('AI_RENAME_CANCELLED')
        }

        const errorMessage = getErrorMessage(error)
        const isUnrecognizedTitle = ['AI 未识别出剧名', 'AI 未识别出电影名'].includes(errorMessage)
        const isUnsafeMediaType = errorMessage.startsWith('AI 将电影目录识别为电视剧')
        const shouldSkip = isUnrecognizedTitle || isUnsafeMediaType
        job.progress.totalOperations += 1
        appendAiRenameJobResult(
          job,
          {
            action: 'analyze',
            message: isUnrecognizedTitle ? 'AI 未识别出可靠媒体名称，已跳过' : errorMessage,
            oldPath: groupEntries[0]?.path,
            status: shouldSkip ? 'skipped' : 'failed',
          },
          shouldSkip ? 'skipped' : 'failed',
        )
      } finally {
        job.progress.processedGroups = groupIndex
      }
    }

    throwIfAiRenameCancelled(job)

    job.status =
      job.progress.failed > 0 || job.progress.skipped > 0
        ? job.progress.succeeded > 0
          ? 'partial'
          : 'failed'
        : 'completed'
    const completionMessage = `处理完成：成功 ${job.progress.succeeded}，跳过 ${job.progress.skipped}，失败 ${job.progress.failed}`

    if (payload.incrementalStateKey) {
      job.message = completionMessage
    } else {
      setAiRenameJobStage(job, 'finished', completionMessage)
    }
  } catch (error) {
    if (job.cancelRequested || error?.message === 'AI_RENAME_CANCELLED') {
      job.status = 'cancelled'
      setAiRenameJobStage(job, 'cancelled', '任务已取消，已完成的操作不会回滚')
    } else {
      job.status = 'failed'
      setAiRenameJobStage(job, 'failed', getErrorMessage(error))
      appendAiRenameJobResult(job, {
        action: 'job',
        message: getErrorMessage(error),
        status: 'failed',
      })
    }
  } finally {
    const terminalStatus = job.status
    const completionMessage = job.message
    const shouldUpdateIncrementalBaseline =
      Boolean(job.taskId && payload.incrementalStateKey && payload.configurationFingerprint) &&
      ['completed', 'partial'].includes(terminalStatus) &&
      Boolean(storage && settings)

    if (shouldUpdateIncrementalBaseline) {
      job.status = 'running'
      setAiRenameJobStage(job, 'scanning', '正在保存本次运行后的增量基线')

      try {
        const groupFingerprints =
          job.incrementalInventory?.submittedGroups === 0
            ? job.incrementalInventory.currentFingerprints
            : await scanAiRenameInventoryFingerprints(storage, payload.path, settings)
        await saveAiRenameIncrementalTaskState(payload.incrementalStateKey, {
          configurationFingerprint: payload.configurationFingerprint,
          groupFingerprints: [...new Set(groupFingerprints)].sort(),
          path: payload.path,
          storageId: payload.storageId,
          updatedAt: new Date().toISOString(),
        })
        job.incrementalInventory.baselineUpdated = true
        appendAiRenameJobResult(job, {
          action: 'inventory',
          message: `增量基线已更新：${groupFingerprints.length} 个视频目录；下次仅提交新增或变化目录`,
          oldPath: payload.path,
          status: 'info',
        })
      } catch (error) {
        appendAiRenameJobResult(job, {
          action: 'inventory',
          message: `更新增量基线失败，下次将重新识别：${getErrorMessage(error)}`,
          oldPath: payload.path,
          status: 'warning',
        })
      } finally {
        job.status = terminalStatus
        setAiRenameJobStage(job, 'finished', completionMessage)
      }
    }

    job.currentPath = ''
    job.finishedAt = new Date().toISOString()
    activeAiRenameJobsByStorage.delete(job.storageId)

    if (job.taskId) {
      await saveAiRenameTaskRunState(job.taskId, {
        currentJobId: '',
        lastJob: getAiRenameJobForClient(job),
        lastRunAt: job.finishedAt,
        status: job.status,
      }).catch(() => undefined)
    }
  }
}

function scheduleAiRenameJob(job, payload) {
  setImmediate(() => {
    void runAiRenameJob(job, payload)
  })
}

async function createAiRenameJob(payload, options = {}) {
  const storageId = String(payload.storageId ?? '').trim()
  const requestedPath = String(payload.path ?? '').trim()

  if (!storageId || !requestedPath) {
    throw new Error('缺少存储或目录路径')
  }

  const existingJobId = activeAiRenameJobsByStorage.get(storageId)

  if (existingJobId) {
    const existingJob = aiRenameJobs.get(existingJobId)

    if (existingJob && ['queued', 'running'].includes(existingJob.status)) {
      const error = new Error('该存储已有 AI 重命名任务正在运行')
      error.statusCode = 409
      throw error
    }
  }

  const settings = await readSettings()
  const aiSettings = normalizeAiRenameSettings(settings.aiRename)

  if (!aiSettings.apiKey || !aiSettings.model || !aiSettings.baseUrl) {
    throw new Error('请先在系统设置中完成 AI 重命名接口配置')
  }

  if (payload.useTmdb === true && (!aiSettings.tmdbEnabled || !aiSettings.tmdbToken)) {
    throw new Error('TMDB 校验未启用或未配置 Read Access Token')
  }

  const allowMove =
    typeof payload.allowMove === 'boolean' ? payload.allowMove : aiSettings.rebuildFolders

  const job = {
    abortController: new AbortController(),
    allowMove,
    cancelRequested: false,
    createdAt: new Date().toISOString(),
    currentPath: '',
    finishedAt: undefined,
    id: `rename-${Date.now()}-${createSecret(6)}`,
    message: '任务已创建',
    path: requestedPath,
    progress: {
      analyzed: 0,
      completedOperations: 0,
      failed: 0,
      ignored: 0,
      inventoryGroups: 0,
      scanned: 0,
      skipped: 0,
      succeeded: 0,
      totalOperations: 0,
      processedGroups: 0,
      totalGroups: 0,
      unchangedGroups: 0,
    },
    results: [],
    stage: 'queued',
    startedAt: undefined,
    status: 'queued',
    storageId,
    taskId: String(payload.taskId ?? '').trim() || undefined,
    useTmdb: payload.useTmdb === true,
  }

  aiRenameJobs.set(job.id, job)
  activeAiRenameJobsByStorage.set(storageId, job.id)
  if (!options.deferStart) {
    scheduleAiRenameJob(job, {
      ...payload,
      allowMove,
      path: requestedPath,
      storageId,
    })
  }

  return getAiRenameJobForClient(job)
}

function cancelAiRenameJob(jobId) {
  const job = aiRenameJobs.get(jobId)

  if (!job) {
    throw new Error('未找到 AI 重命名任务')
  }

  if (['completed', 'partial', 'failed', 'cancelled'].includes(job.status)) {
    return getAiRenameJobForClient(job)
  }

  job.cancelRequested = true
  job.abortController.abort()
  job.message = '正在停止任务'
  return getAiRenameJobForClient(job)
}

function normalizeAiRenameTask(values = {}, existing = {}) {
  const now = new Date().toISOString()
  const id = String(values.id || existing.id || '').trim()
  const name = String(values.name || existing.name || '').trim()
  const storageId = String(values.storageId || existing.storageId || '').trim()
  const taskPath = String(values.path || existing.path || '').trim()

  if (!id || !name || !storageId || !taskPath) {
    throw new Error('AI 重命名任务缺少名称、存储或路径')
  }

  return {
    ...existing,
    allowMove: values.allowMove === true,
    createdAt: existing.createdAt || now,
    extraPrompt: String(values.extraPrompt ?? '').trim(),
    id,
    name,
    path: taskPath,
    status: existing.status || 'idle',
    storageId,
    updatedAt: now,
    useTmdb: values.useTmdb === true,
  }
}

async function readAiRenameTasksForClient() {
  const tasks = await readAiRenameTasks()

  return tasks.map((task) => {
    const activeJob = task.currentJobId ? aiRenameJobs.get(task.currentJobId) : undefined

    if (activeJob) {
      return {
        ...task,
        lastJob: getAiRenameJobForClient(activeJob),
        status: activeJob.status,
      }
    }

    if (task.currentJobId) {
      const lastStatus = task.lastJob?.status
      const status = ['completed', 'partial', 'failed', 'cancelled'].includes(lastStatus)
        ? lastStatus
        : 'failed'
      return { ...task, currentJobId: '', status }
    }

    return task
  })
}

async function saveAiRenameTask(taskId, values) {
  const tasks = await readAiRenameTasks()
  const existing = tasks.find((task) => task.id === taskId)

  if (existing?.currentJobId) {
    const activeJob = aiRenameJobs.get(existing.currentJobId)

    if (activeJob && !['completed', 'partial', 'failed', 'cancelled'].includes(activeJob.status)) {
      throw new Error('任务正在运行，无法编辑')
    }

    if (!activeJob) {
      existing.currentJobId = ''
      existing.status = ['completed', 'partial', 'failed', 'cancelled'].includes(
        existing.lastJob?.status,
      )
        ? existing.lastJob.status
        : 'failed'
    }
  }

  const task = normalizeAiRenameTask({ ...values, id: taskId }, existing)
  const nextTasks = existing
    ? tasks.map((item) => (item.id === taskId ? task : item))
    : [...tasks, task]
  await writeAiRenameTasks(nextTasks)
  return task
}

async function saveAiRenameTaskRunState(taskId, patch) {
  const tasks = await readAiRenameTasks()
  const task = tasks.find((item) => item.id === taskId)

  if (!task) {
    throw new Error('未找到 AI 重命名任务')
  }

  const nextTask = { ...task, ...patch, updatedAt: new Date().toISOString() }
  await writeAiRenameTasks(tasks.map((item) => (item.id === taskId ? nextTask : item)))
  return nextTask
}

async function deleteAiRenameTask(taskId) {
  const tasks = await readAiRenameTasks()
  const task = tasks.find((item) => item.id === taskId)

  if (!task) {
    return false
  }

  const activeJob = task.currentJobId ? aiRenameJobs.get(task.currentJobId) : undefined

  if (activeJob && !['completed', 'partial', 'failed', 'cancelled'].includes(activeJob.status)) {
    throw new Error('任务正在运行，无法删除')
  }

  await writeAiRenameTasks(tasks.filter((item) => item.id !== taskId))
  await deleteAiRenameIncrementalTaskState(getManagedAiRenameIncrementalStateKey(taskId)).catch(
    () => undefined,
  )
  return true
}

async function runAiRenameTask(taskId) {
  const tasks = await readAiRenameTasks()
  const task = tasks.find((item) => item.id === taskId)

  if (!task) {
    throw new Error('未找到 AI 重命名任务')
  }

  if (task.currentJobId) {
    const currentJob = aiRenameJobs.get(task.currentJobId)

    if (
      currentJob &&
      !['completed', 'partial', 'failed', 'cancelled'].includes(currentJob.status)
    ) {
      const error = new Error('该任务已经在运行')
      error.statusCode = 409
      throw error
    }
  }

  const settings = await readSettings()
  const aiSettings = normalizeAiRenameSettings(settings.aiRename)
  const configurationFingerprint = createAiRenameConfigurationFingerprint(aiSettings, {
    allowMove: task.allowMove === true,
    extraPrompt: String(task.extraPrompt ?? '').trim(),
    useTmdb: task.useTmdb === true,
  })
  const incrementalStateKey = getManagedAiRenameIncrementalStateKey(task.id)
  let incrementalBaselineStatus = 'missing'
  let incrementalBaselineMessage = '增量基线不存在或任务配置已变化，本次执行全量目录识别。'
  let unchangedGroupFingerprints = []

  try {
    const incrementalState = await readAiRenameIncrementalState()
    const taskState = incrementalState[incrementalStateKey]
    const canReuseState =
      taskState?.configurationFingerprint === configurationFingerprint &&
      taskState?.storageId === task.storageId &&
      taskState?.path === task.path &&
      Array.isArray(taskState?.groupFingerprints)

    if (canReuseState) {
      unchangedGroupFingerprints = taskState.groupFingerprints.map((fingerprint) =>
        String(fingerprint),
      )
      incrementalBaselineStatus = 'loaded'
      incrementalBaselineMessage = `已加载增量基线：${unchangedGroupFingerprints.length} 个已处理视频目录。`
    }
  } catch (error) {
    incrementalBaselineStatus = 'error'
    incrementalBaselineMessage = `读取增量基线失败，本次回退全量识别：${getErrorMessage(error)}`
  }

  const payload = {
    allowMove: task.allowMove,
    configurationFingerprint,
    extraPrompt: task.extraPrompt,
    incrementalBaselineMessage,
    incrementalBaselineStatus,
    incrementalStateKey,
    path: task.path,
    recursive: true,
    storageId: task.storageId,
    taskId: task.id,
    unchangedGroupFingerprints,
    useTmdb: task.useTmdb,
  }
  const job = await createAiRenameJob(payload, { deferStart: true })
  let nextTask

  try {
    nextTask = await saveAiRenameTaskRunState(taskId, {
      currentJobId: job.id,
      lastJob: job,
      lastRunAt: new Date().toISOString(),
      status: 'running',
    })
  } catch (error) {
    aiRenameJobs.delete(job.id)
    activeAiRenameJobsByStorage.delete(job.storageId)
    throw error
  }

  const queuedJob = aiRenameJobs.get(job.id)
  scheduleAiRenameJob(queuedJob, { ...payload, allowMove: job.allowMove })

  return { job, task: nextTask }
}

async function stopAiRenameTask(taskId) {
  const tasks = await readAiRenameTasks()
  const task = tasks.find((item) => item.id === taskId)

  if (!task?.currentJobId) {
    throw new Error('任务当前未运行')
  }

  const job = cancelAiRenameJob(task.currentJobId)
  const nextTask = await saveAiRenameTaskRunState(taskId, {
    lastJob: job,
    status: 'running',
  })
  return { job, task: nextTask }
}

async function getAiRenameTaskResult(taskId) {
  const tasks = await readAiRenameTasks()
  const task = tasks.find((item) => item.id === taskId)

  if (!task) {
    throw new Error('未找到 AI 重命名任务')
  }

  const activeJob = task.currentJobId ? aiRenameJobs.get(task.currentJobId) : undefined
  return activeJob ? getAiRenameJobForClient(activeJob) : task.lastJob || null
}

function getAiRenameTaskRoute(requestUrl) {
  const pathname = new URL(requestUrl || '/', 'http://localhost').pathname
  const match = pathname.match(/^\/api\/ai-rename\/tasks\/([^/]+)(?:\/(run|stop|result))?$/)

  if (!match) {
    return undefined
  }

  return {
    action: match[2] ?? '',
    taskId: decodeURIComponent(match[1]),
  }
}

async function runAllAiRenameTasks() {
  const tasks = await readAiRenameTasks()
  const results = []

  for (const task of tasks) {
    try {
      results.push(await runAiRenameTask(task.id))
    } catch (error) {
      results.push({ error: getErrorMessage(error), task })
    }
  }

  return { results, tasks: await readAiRenameTasksForClient() }
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

async function hashFile(filePath) {
  const hash = createHash('sha256')
  hash.update(await readFile(filePath))
  return hash.digest('hex')
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
  const hasExistingPluginFile = Boolean(targetFile && (await pathExists(targetFile)))
  let replacementRequired = false

  if (hasExistingPluginFile && path.resolve(sourceFile) !== path.resolve(targetFile)) {
    try {
      replacementRequired = (await hashFile(sourceFile)) !== (await hashFile(targetFile))
    } catch {
      replacementRequired = true
    }
  }

  const installed = hasExistingPluginFile
  const capabilities = await getStrmAssistantCapabilities(sourceFile, installed)
  const pluginSettings = await readStrmAssistantPluginSettings(baseUrl, settings, detection)
  const { taskSchedules, taskSyncError } = await syncStrmAssistantTaskSchedulesFromEmby(
    baseUrl,
    settings,
  )

  return {
    capabilities,
    containerPluginDirectory: detection.containerPluginDirectory,
    detectionSource: detection.source,
    embyContainerName: detection.embyContainerName ?? '',
    foundPluginDirectory: detection.found,
    hasExistingPluginFile,
    installed,
    pluginDirectory,
    pluginFileName,
    pluginSettings: {
      configFile: pluginSettings.configFile,
      pluginId: pluginSettings.pluginId,
      pluginName: pluginSettings.pluginName,
      pluginVersion: pluginSettings.pluginVersion,
      source: pluginSettings.source,
      syncError: pluginSettings.syncError,
      updatedAt: pluginSettings.updatedAt,
      values: pluginSettings.values,
    },
    replacementRequired,
    sourceExists: Boolean(sourceFile && (await pathExists(sourceFile))),
    sourceFile,
    taskSchedules,
    taskSyncError,
    targetFile,
  }
}

async function installEmbyPlugin(baseUrl = '', options = {}) {
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
  const targetExists = await pathExists(targetFile)
  let replacementRequired = false

  if (targetExists && path.resolve(sourceFile) !== path.resolve(targetFile)) {
    try {
      replacementRequired = (await hashFile(sourceFile)) !== (await hashFile(targetFile))
    } catch {
      replacementRequired = true
    }
  }

  if (replacementRequired && options.forceReplace !== true) {
    const error = new Error(
      `检测到 Emby 插件目录中已存在 ${strmAssistantInstalledPluginFileName}，如需使用 OpenStrmBridge 特调版，请确认替换原插件。`,
    )
    error.statusCode = 409
    error.title = '检测到已有神医助手插件'
    error.replacementRequired = true
    throw error
  }

  if (replacementRequired) {
    await unlink(targetFile)
  }

  if (path.resolve(sourceFile) !== path.resolve(targetFile)) {
    await copyFile(sourceFile, targetFile)
  }

  const targetStat = await stat(targetFile)
  const capabilities = await getStrmAssistantCapabilities(sourceFile, true)
  const currentStatus = await getEmbyPluginStatus(baseUrl)

  return {
    capabilities,
    containerPluginDirectory: detection.containerPluginDirectory,
    detectionSource: detection.source,
    embyContainerName: detection.embyContainerName ?? '',
    foundPluginDirectory: true,
    hasExistingPluginFile: true,
    installed: true,
    message: '神医助手插件已安装到 Emby 插件目录。',
    pluginDirectory,
    pluginFileName: strmAssistantInstalledPluginFileName,
    replacementRequired: false,
    size: targetStat.size,
    sourceExists: Boolean(sourceFile && (await pathExists(sourceFile))),
    sourceFile,
    pluginSettings: currentStatus.pluginSettings,
    taskSchedules: currentStatus.taskSchedules,
    taskSyncError: currentStatus.taskSyncError,
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

async function startStrmAssistant(baseUrl = '', options = {}) {
  const installedPlugin = await installEmbyPlugin(baseUrl, options)

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
      embyScheduleEnabled: previousSchedule.embyScheduleEnabled,
      embyTaskId: previousSchedule.embyTaskId,
      embyTaskName: previousSchedule.embyTaskName,
      embyTaskState: previousSchedule.embyTaskState,
      embyTriggerCount: previousSchedule.embyTriggerCount,
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getNestedValue(source, segments) {
  let current = source

  for (const segment of segments) {
    if (!isPlainObject(current)) {
      return undefined
    }

    current = current[segment]
  }

  return current
}

function setNestedValue(target, segments, value) {
  let current = target

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]

    if (!isPlainObject(current[segment])) {
      current[segment] = {}
    }

    current = current[segment]
  }

  current[segments[segments.length - 1]] = value
}

function normalizeStrmAssistantPluginSettingValue(definition, value) {
  if (definition.type === 'boolean') {
    if (typeof value === 'boolean') {
      return value
    }

    if (typeof value === 'number') {
      return value !== 0
    }

    const normalized = String(value ?? '')
      .trim()
      .toLowerCase()

    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
      return true
    }

    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
      return false
    }

    return definition.defaultValue
  }

  const numeric = Number(value)
  const fallback = Number(definition.defaultValue ?? 0)
  const finiteValue = Number.isFinite(numeric) ? numeric : fallback
  const roundedValue = Math.round(finiteValue)

  return Math.max(
    Number(definition.min ?? Number.MIN_SAFE_INTEGER),
    Math.min(Number(definition.max ?? Number.MAX_SAFE_INTEGER), roundedValue),
  )
}

function createDefaultStrmAssistantPluginConfiguration() {
  const configuration = {
    AboutOptions: {},
    ExperienceEnhanceOptions: {
      MergeMultiVersion: false,
    },
    GeneralOptions: {
      CatchupMode: false,
      CooldownDurationSeconds: 0,
      MaxConcurrentCount: 1,
      Tier2MaxConcurrentCount: 1,
    },
    IntroSkipOptions: {
      EnableIntroSkip: false,
      UnlockIntroSkip: false,
    },
    MediaInfoExtractOptions: {
      EnableImageCapture: false,
      IncludeExtra: false,
    },
    MetadataEnhanceOptions: {
      EpisodeRefreshLookbackDays: 365,
    },
  }

  for (const definition of Object.values(strmAssistantPluginSettingDefinitions)) {
    setNestedValue(configuration, definition.path, definition.defaultValue)
  }

  return configuration
}

function normalizeStrmAssistantPluginConfiguration(configuration = {}) {
  const nextConfiguration = {
    ...createDefaultStrmAssistantPluginConfiguration(),
    ...(isPlainObject(configuration) ? configuration : {}),
  }

  for (const definition of Object.values(strmAssistantPluginSettingDefinitions)) {
    const currentValue = getNestedValue(nextConfiguration, definition.path)
    setNestedValue(
      nextConfiguration,
      definition.path,
      normalizeStrmAssistantPluginSettingValue(definition, currentValue),
    )
  }

  return nextConfiguration
}

function getStrmAssistantPluginSettingValues(configuration = {}) {
  const normalizedConfiguration = normalizeStrmAssistantPluginConfiguration(configuration)
  const values = {}

  for (const [settingId, definition] of Object.entries(strmAssistantPluginSettingDefinitions)) {
    values[settingId] = normalizeStrmAssistantPluginSettingValue(
      definition,
      getNestedValue(normalizedConfiguration, definition.path),
    )
  }

  return values
}

async function fetchEmbyPlugins(settings) {
  const payload = await requestEmbyApi(settings, '/Plugins')

  if (Array.isArray(payload)) {
    return payload
  }

  if (Array.isArray(payload?.Items)) {
    return payload.Items
  }

  return []
}

async function getStrmAssistantPluginInfo(settings) {
  try {
    const plugins = await fetchEmbyPlugins(settings)

    return (
      plugins.find((plugin) => {
        const name = String(plugin?.Name ?? plugin?.name ?? '').toLowerCase()
        const id = String(plugin?.Id ?? plugin?.id ?? '').toLowerCase()
        const assembly = String(
          plugin?.AssemblyFileName ?? plugin?.assemblyFileName ?? plugin?.FileName ?? '',
        ).toLowerCase()

        return (
          name.includes('strm assistant') ||
          name.includes('strmassistant') ||
          id === '63c322b7-a371-41a3-b11f-04f8418b37d8' ||
          assembly.includes('strmassistant')
        )
      }) ?? null
    )
  } catch {
    return null
  }
}

function getStrmAssistantPluginId(pluginInfo) {
  return String(pluginInfo?.Id ?? pluginInfo?.id ?? '').trim()
}

function getStrmAssistantPluginConfigurationName(pluginInfo) {
  return String(
    pluginInfo?.ConfigurationFileName ??
      pluginInfo?.configurationFileName ??
      pluginInfo?.ConfigurationFilePath ??
      pluginInfo?.configurationFilePath ??
      '',
  ).trim()
}

function resolveStrmAssistantPluginConfigurationFile(pluginInfo, detection = {}) {
  const pluginDirectory = String(detection.pluginDirectory ?? '').trim()
  const configurationName = getStrmAssistantPluginConfigurationName(pluginInfo)
  const defaultConfigurationFile = pluginDirectory
    ? path.join(pluginDirectory, 'configurations', 'Strm Assistant.json')
    : ''

  if (!pluginDirectory) {
    return defaultConfigurationFile
  }

  if (!configurationName) {
    return defaultConfigurationFile
  }

  const normalizedConfigurationName = configurationName.replace(/\\/g, '/')
  const pluginDirectoryRoot = path.dirname(pluginDirectory)

  if (normalizedConfigurationName.startsWith('/config/plugins/')) {
    return path.join(pluginDirectory, normalizedConfigurationName.slice('/config/plugins/'.length))
  }

  if (normalizedConfigurationName === '/config/plugins') {
    return defaultConfigurationFile
  }

  if (normalizedConfigurationName.startsWith('/config/')) {
    return path.join(pluginDirectoryRoot, normalizedConfigurationName.slice('/config/'.length))
  }

  if (path.isAbsolute(configurationName)) {
    return configurationName
  }

  return path.join(pluginDirectory, 'configurations', configurationName)
}

async function readJsonConfigFile(filePath) {
  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content)
}

async function writeJsonConfigFile(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(`${filePath}.tmp`, JSON.stringify(payload, null, 2), 'utf8')
  await rename(`${filePath}.tmp`, filePath)
}

async function readStrmAssistantPluginConfigurationFromEmby(settings, pluginInfo) {
  const pluginId = getStrmAssistantPluginId(pluginInfo)

  if (!pluginId) {
    return null
  }

  const payload = await requestEmbyApi(
    settings,
    `/Plugins/${encodeURIComponent(pluginId)}/Configuration`,
  )

  return isPlainObject(payload) ? payload : null
}

async function writeStrmAssistantPluginConfigurationToEmby(settings, pluginInfo, configuration) {
  const pluginId = getStrmAssistantPluginId(pluginInfo)

  if (!pluginId) {
    throw new Error('Emby 插件没有返回配置接口 ID')
  }

  return requestEmbyApi(settings, `/Plugins/${encodeURIComponent(pluginId)}/Configuration`, {
    body: JSON.stringify(configuration),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })
}

async function readStrmAssistantPluginSettings(baseUrl = '', providedSettings, providedDetection) {
  const settings = providedSettings ?? (await readSettings(baseUrl))
  const detection = providedDetection ?? (await detectEmbyPluginDirectory(baseUrl))
  const pluginInfo = await getStrmAssistantPluginInfo(settings)
  const configFile = resolveStrmAssistantPluginConfigurationFile(pluginInfo, detection)
  let configuration
  let source = 'defaults'
  let apiWarning = ''
  let syncError = ''

  if (pluginInfo) {
    try {
      configuration = await readStrmAssistantPluginConfigurationFromEmby(settings, pluginInfo)

      if (configuration) {
        source = 'emby-api'
      }
    } catch (error) {
      apiWarning = getErrorMessage(error)
    }
  }

  if (!configuration && configFile) {
    try {
      if (await pathExists(configFile)) {
        configuration = await readJsonConfigFile(configFile)
        source = 'file'
        syncError = ''
      }
    } catch (error) {
      syncError = [apiWarning, `读取插件配置文件失败：${getErrorMessage(error)}`]
        .filter(Boolean)
        .join('；')
    }
  }

  if (!configuration && apiWarning && !syncError) {
    syncError = apiWarning
  }

  const normalizedConfiguration = normalizeStrmAssistantPluginConfiguration(configuration)

  return {
    apiWarning,
    configFile,
    configuration: normalizedConfiguration,
    pluginId: getStrmAssistantPluginId(pluginInfo),
    pluginName: String(pluginInfo?.Name ?? pluginInfo?.name ?? 'Strm Assistant'),
    pluginVersion: String(pluginInfo?.Version ?? pluginInfo?.version ?? ''),
    source,
    syncError,
    updatedAt: new Date().toISOString(),
    values: getStrmAssistantPluginSettingValues(normalizedConfiguration),
  }
}

async function updateStrmAssistantPluginSettings(values = {}, baseUrl = '') {
  const settings = await readSettings(baseUrl)
  const detection = await detectEmbyPluginDirectory(baseUrl)
  const pluginInfo = await getStrmAssistantPluginInfo(settings)
  const currentSettings = await readStrmAssistantPluginSettings(baseUrl, settings, detection)
  const nextConfiguration = normalizeStrmAssistantPluginConfiguration(currentSettings.configuration)
  const nextValues = isPlainObject(values?.values) ? values.values : values
  let applied = false

  for (const [settingId, value] of Object.entries(nextValues ?? {})) {
    const definition = strmAssistantPluginSettingDefinitions[settingId]

    if (!definition) {
      continue
    }

    setNestedValue(
      nextConfiguration,
      definition.path,
      normalizeStrmAssistantPluginSettingValue(definition, value),
    )
    applied = true
  }

  if (!applied) {
    throw new Error('没有可同步的神医助手插件参数')
  }

  const configFile =
    currentSettings.configFile || resolveStrmAssistantPluginConfigurationFile(pluginInfo, detection)

  if (!configFile) {
    throw new Error('未找到可写入的神医助手插件配置文件路径')
  }

  await writeJsonConfigFile(configFile, nextConfiguration)

  let writeWarning = ''

  if (pluginInfo && currentSettings.source === 'emby-api') {
    try {
      await writeStrmAssistantPluginConfigurationToEmby(settings, pluginInfo, nextConfiguration)
    } catch (error) {
      writeWarning = `已写入插件配置文件，但 Emby 配置接口未接受即时刷新：${getErrorMessage(error)}`
    }
  } else if (!pluginInfo) {
    writeWarning = '已写入插件配置文件，但当前未从 Emby 插件列表中识别到 Strm Assistant。'
  }

  const defaults = await getEmbyPluginDefaults(baseUrl)
  const status = await getEmbyPluginStatus(baseUrl)

  return {
    ...defaults,
    status: {
      ...status,
      pluginSettings: {
        ...status.pluginSettings,
        writeWarning,
      },
    },
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
  const resultRelevant = resultAfterTrigger || (!lastTriggeredAt && Boolean(resultEndAt))
  let runStatus = previousSchedule.runStatus || 'idle'
  let runProgress = previousSchedule.runProgress ?? 0
  let runMessage = previousSchedule.runMessage || '未执行'

  if (normalizedState.includes('running')) {
    runStatus = 'running'
    runProgress = currentProgress
    runMessage = '正在执行'
  } else if (resultRelevant) {
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
    lastFinishedAt: resultRelevant && resultEndAt ? resultEndAt.toISOString() : '',
    runMessage,
    runProgress,
    runStatus,
    runUpdatedAt: new Date().toISOString(),
    taskId: definition.taskId,
    taskName: definition.taskName,
  }
}

function getEmbyTaskTriggers(task) {
  for (const key of ['Triggers', 'triggers', 'TriggerInfos', 'triggerInfos']) {
    if (Array.isArray(task?.[key])) {
      return task[key]
    }
  }

  return []
}

function getEmbyTriggerIntervalHours(trigger) {
  const rawCandidates = [
    trigger?.IntervalHours,
    trigger?.intervalHours,
    trigger?.Hours,
    trigger?.hours,
  ]
  const hourValue = rawCandidates.map((value) => Number(value)).find((value) => value > 0)

  if (hourValue) {
    return Math.max(1, Math.round(hourValue))
  }

  const minuteValue = [trigger?.IntervalMinutes, trigger?.intervalMinutes, trigger?.Minutes]
    .map((value) => Number(value))
    .find((value) => value > 0)

  if (minuteValue) {
    return Math.max(1, Math.round(minuteValue / 60))
  }

  const secondValue = [trigger?.IntervalSeconds, trigger?.intervalSeconds, trigger?.Seconds]
    .map((value) => Number(value))
    .find((value) => value > 0)

  if (secondValue) {
    return Math.max(1, Math.round(secondValue / 3600))
  }

  const ticksValue = [trigger?.IntervalTicks, trigger?.intervalTicks, trigger?.Ticks]
    .map((value) => Number(value))
    .find((value) => value > 0)

  if (ticksValue) {
    return Math.max(1, Math.round(ticksValue / 36_000_000_000))
  }

  const typeText = String(trigger?.Type ?? trigger?.type ?? trigger?.Name ?? '').toLowerCase()

  if (typeText.includes('daily')) {
    return 24
  }

  if (typeText.includes('weekly')) {
    return 168
  }

  return undefined
}

function getEmbyTaskExecutionSnapshot(task, previousSchedule = {}) {
  const triggers = getEmbyTaskTriggers(task)
  const enabledTriggers = triggers.filter((trigger) => trigger?.Enabled !== false)
  const embyScheduleEnabled = enabledTriggers.length > 0
  const intervalHours =
    enabledTriggers
      .map(getEmbyTriggerIntervalHours)
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right)[0] ??
    previousSchedule.intervalHours ??
    1
  const previousModes =
    Array.isArray(previousSchedule.modes) && previousSchedule.modes.length > 0
      ? previousSchedule.modes
      : previousSchedule.mode
        ? [previousSchedule.mode]
        : []
  const modes = [...new Set([...previousModes, ...(embyScheduleEnabled ? ['hourly'] : [])])]

  return {
    embyScheduleEnabled,
    embyTriggerCount: enabledTriggers.length,
    enabled: previousSchedule.enabled === true || embyScheduleEnabled,
    intervalHours,
    mode: modes[0] || 'hourly',
    modes: modes.length > 0 ? modes : ['hourly'],
  }
}

function getAllStrmAssistantTaskDefinitions() {
  return Object.keys(strmAssistantTaskClassById).map((taskId) =>
    getStrmAssistantTaskDefinition(taskId),
  )
}

async function syncStrmAssistantTaskSchedulesFromEmby(baseUrl = '', providedSettings) {
  const settings = providedSettings ?? (await readSettings(baseUrl))
  const previousSchedules = settings.strmAssistant?.taskSchedules ?? {}

  try {
    const embyTasks = await fetchEmbyScheduledTasks(settings)
    const taskSchedules = { ...previousSchedules }
    let changed = false

    for (const definition of getAllStrmAssistantTaskDefinitions()) {
      const previousSchedule = taskSchedules[definition.taskId] ?? {}
      const embyTask = findStrmAssistantScheduledTask(
        embyTasks,
        definition,
        previousSchedule.embyTaskId,
      )

      if (!embyTask) {
        continue
      }

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
        updatedAt: previousSchedule.updatedAt || new Date().toISOString(),
        ...previousSchedule,
        ...getEmbyTaskExecutionSnapshot(embyTask, previousSchedule),
        ...getEmbyTaskRunSnapshot(embyTask, definition, previousSchedule),
      }

      if (JSON.stringify(taskSchedules[definition.taskId] ?? {}) !== JSON.stringify(nextSchedule)) {
        changed = true
      }

      taskSchedules[definition.taskId] = nextSchedule
    }

    if (changed) {
      await updateSettingsSection('strmAssistant', { taskSchedules }, baseUrl)
    }

    return {
      taskSchedules,
      taskSyncError: '',
    }
  } catch (error) {
    return {
      taskSchedules: previousSchedules,
      taskSyncError: getErrorMessage(error),
    }
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
  sourceUrl,
) {
  const outputDirectory = getTaskOutputDirectory(task.name, strmSettings.outputRoot)
  const strmRelativePath = path.relative(outputDirectory, outputFile) || relativePath

  return {
    relativePath: strmRelativePath,
    sourcePath: entryPath,
    sourceUrl,
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

function shouldAppendAListSign(storage) {
  return storage?.accessMethod === 'openlist' || storage?.accessMethod === 'webdav'
}

function shouldUseStrmRedirect(storage) {
  return storage?.accessMethod === 'openlist' || storage?.accessMethod === 'webdav'
}

function createStrmRedirectUrl(storage, entryPath) {
  const backendBaseUrl = getLocalBackendBaseUrl()
  return `${backendBaseUrl}/api/strm/redirect/${encodeURIComponent(storage.id)}${encodePathSegments(entryPath)}`
}

function inferAListEndpointFromWebDav(endpoint) {
  const normalizedEndpoint = normalizeEndpoint(endpoint)

  if (!normalizedEndpoint) {
    return ''
  }

  try {
    const url = new URL(normalizedEndpoint)
    url.pathname = url.pathname.replace(/\/dav(?:\/.*)?$/i, '') || '/'
    url.search = ''
    url.hash = ''
    return normalizeEndpoint(url.toString())
  } catch {
    return normalizedEndpoint
  }
}

function getAList115Endpoint(storage) {
  return normalizeEndpoint(
    storage.alist115?.endpoint ||
      (storage.accessMethod === 'openlist'
        ? storage.endpoint
        : inferAListEndpointFromWebDav(storage.endpoint)),
  )
}

function getAList115Token(storage) {
  return String(storage.alist115?.token || storage.openlist?.token || '').trim()
}

async function loginAListWithCredentials(endpoint, username, password, context = {}) {
  if (
    context.alist115LoginEndpoint === endpoint &&
    context.alist115LoginUsername === username &&
    context.alist115Token
  ) {
    return context.alist115Token
  }

  const auth = await requestOpenListApi(endpoint, '/api/auth/login', '', {
    body: JSON.stringify({
      username,
      password,
    }),
    headers: {
      'Client-Id': 'openstrmbridge-webdav-sign',
    },
    method: 'POST',
  })
  const token = String(auth?.token ?? '').trim()

  if (!token) {
    throw new Error('AList 登录未返回 token')
  }

  context.alist115LoginEndpoint = endpoint
  context.alist115LoginUsername = username
  context.alist115Token = token

  return token
}

async function resolveAListSignToken(storage, endpoint, context = {}) {
  if (storage.accessMethod === 'webdav') {
    const username = String(storage.webdav?.username ?? '').trim()
    const password = String(storage.webdav?.password ?? '').trim()

    if (!username || !password) {
      throw new Error('直链签名缺少 WebDAV 用户名或密码')
    }

    try {
      return await loginAListWithCredentials(endpoint, username, password, context)
    } catch (error) {
      const fallbackToken = getAList115Token(storage)

      if (fallbackToken) {
        context.alist115Token = fallbackToken
        return fallbackToken
      }

      throw new Error(`直链签名使用 WebDAV 账号登录失败: ${getErrorMessage(error)}`)
    }
  }

  const token = context.alist115Token || getAList115Token(storage)

  if (token) {
    context.alist115Token = token
  }

  return token
}

function getWebDavAListPrefix(storage) {
  try {
    const pathname = safeDecodePathname(new URL(normalizeEndpoint(storage.endpoint)).pathname)
    const match = pathname.match(/\/dav(?:\/(.*))?$/i)

    return normalizeRemotePath(match?.[1] || '')
  } catch {
    return '/'
  }
}

function getAList115ApiPath(storage, entryPath) {
  if (storage.accessMethod !== 'webdav') {
    return normalizeRemotePath(entryPath)
  }

  const prefix = getWebDavAListPrefix(storage)

  if (prefix === '/') {
    return normalizeRemotePath(entryPath)
  }

  return joinRemotePath(prefix, normalizeRemotePath(entryPath))
}

function createAListDownloadUrl(storage, entryPath) {
  const baseUrl = normalizeEndpoint(
    storage.accessMethod === 'openlist'
      ? storage.openlist?.strmBaseUrl || storage.endpoint
      : getAList115Endpoint(storage),
  )
  const apiPath = getAList115ApiPath(storage, entryPath)
  const remotePath =
    storage.openlist?.enableUrlEncoding === false
      ? getUnencodedRemotePath(apiPath)
      : encodePathSegments(apiPath)

  return `${baseUrl}/d${remotePath}`
}

function appendSignToUrl(rawUrl, sign) {
  const url = new URL(rawUrl)
  url.searchParams.set('sign', sign)
  return url.toString()
}

async function getAList115Sign(storage, entryPath, context = {}) {
  const endpoint = context.alist115Endpoint || getAList115Endpoint(storage)
  const token = await resolveAListSignToken(storage, endpoint, context)
  const apiPath = getAList115ApiPath(storage, entryPath)

  if (!endpoint) {
    throw new Error('直链签名缺少服务地址')
  }

  if (!token) {
    throw new Error('直链签名缺少可调用 /api/fs/get 的访问凭据')
  }

  context.alist115Endpoint = endpoint
  context.alist115Token = token

  const fileInfo = await requestOpenListApi(endpoint, '/api/fs/get', token, {
    body: JSON.stringify({
      path: apiPath,
      password: '',
    }),
    method: 'POST',
  })
  const sign = String(fileInfo?.sign ?? '').trim()

  if (!sign) {
    throw new Error(`AList 未返回 sign：${apiPath}`)
  }

  return sign
}

async function createStrmUrl(storage, entryPath, context = {}) {
  if (shouldAppendAListSign(storage)) {
    return appendSignToUrl(
      createAListDownloadUrl(storage, entryPath),
      await getAList115Sign(storage, entryPath, context),
    )
  }

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

async function createStrmTargetUrl(storage, entryPath, context = {}) {
  if (shouldUseStrmRedirect(storage)) {
    return createStrmRedirectUrl(storage, entryPath)
  }

  return createStrmUrl(storage, entryPath, context)
}

async function generateStrmForEntry({
  entry,
  outputDirectory,
  settings,
  storage,
  strmIndexEntries,
  strmSettings,
  strmUrlContext,
  task,
}) {
  const relativePath = getEntryRelativePath(storage, task.path, entry)
  const outputFile = getOutputFilePath(outputDirectory, relativePath)
  const sourceUrl = await createStrmTargetUrl(storage, entry.path, strmUrlContext)
  const indexEntry = createStrmIndexEntry(
    task,
    storage,
    strmSettings,
    settings,
    outputFile,
    relativePath,
    entry.path,
    sourceUrl,
  )
  const relativeOutputFile = path.relative(outputDirectory, outputFile)

  if (task.incremental && (await pathExists(outputFile))) {
    const currentSourceUrl = await readStrmTarget(outputFile)

    if (currentSourceUrl === sourceUrl) {
      strmIndexEntries.push(indexEntry)

      return {
        outputFile,
        relativeOutputFile,
        status: 'skipped',
      }
    }
  }

  await mkdir(path.dirname(outputFile), { recursive: true })
  await writeFile(outputFile, `${sourceUrl}\n`, 'utf8')
  strmIndexEntries.push(indexEntry)

  return {
    outputFile,
    relativeOutputFile,
    status: 'generated',
  }
}

function getResolvedLocalPathKey(filePath) {
  const resolved = path.resolve(String(filePath ?? ''))
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved
}

async function pruneEmptyStrmDirectories(directoryPaths, outputDirectory, logLines) {
  const resolvedOutputDirectory = path.resolve(outputDirectory)
  const directoriesByKey = new Map()

  for (const directoryPath of directoryPaths) {
    let currentDirectory = path.resolve(directoryPath)

    while (
      currentDirectory !== resolvedOutputDirectory &&
      isLocalPathInside(currentDirectory, resolvedOutputDirectory)
    ) {
      directoriesByKey.set(getResolvedLocalPathKey(currentDirectory), currentDirectory)
      const parentDirectory = path.dirname(currentDirectory)

      if (parentDirectory === currentDirectory) {
        break
      }

      currentDirectory = parentDirectory
    }
  }

  const directories = [...directoriesByKey.values()].sort(
    (first, second) => second.length - first.length,
  )
  let removed = 0

  for (const directoryPath of directories) {
    try {
      await rmdir(directoryPath)
      removed += 1
      logLines.push(`清理空目录: ${path.relative(resolvedOutputDirectory, directoryPath)}`)
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) {
        logLines.push(
          `清理空目录失败: ${path.relative(resolvedOutputDirectory, directoryPath)} - ${getErrorMessage(error)}`,
        )
      }
    }
  }

  return removed
}

async function cleanupStaleStrmFiles({
  currentIndexEntries,
  logLines,
  outputDirectory,
  previousIndexEntries,
  task,
}) {
  const resolvedOutputDirectory = path.resolve(outputDirectory)
  const currentFiles = new Set(
    currentIndexEntries.map((entry) => getResolvedLocalPathKey(entry.strmFile)),
  )
  const previousEntriesByFile = new Map()
  const otherTaskFiles = new Set()

  for (const entry of previousIndexEntries) {
    if (!entry?.strmFile) {
      continue
    }

    const fileKey = getResolvedLocalPathKey(entry.strmFile)

    if (String(entry?.taskId ?? '') === String(task.id)) {
      previousEntriesByFile.set(fileKey, entry)
    } else {
      otherTaskFiles.add(fileKey)
    }
  }

  const staleEntries = [...previousEntriesByFile.entries()].filter(
    ([fileKey]) => !currentFiles.has(fileKey),
  )
  const retainedEntries = []
  const affectedDirectories = new Set()
  let deleted = 0
  let detached = 0
  let failed = 0
  let missing = 0
  let shared = 0

  if (staleEntries.length === 0) {
    logLines.push('旧 STRM 清理完成：没有发现失效文件。')
    return {
      deleted,
      detached,
      failed,
      missing,
      removedDirectories: 0,
      retainedEntries,
      shared,
      stale: 0,
    }
  }

  logLines.push(`发现 ${staleEntries.length} 个失效 STRM，开始安全清理。`)

  for (const [fileKey, entry] of staleEntries) {
    const staleFile = path.resolve(String(entry.strmFile))
    const relativeFile = path.relative(resolvedOutputDirectory, staleFile)
    const isSafeTaskFile =
      staleFile !== resolvedOutputDirectory &&
      isLocalPathInside(staleFile, resolvedOutputDirectory) &&
      path.extname(staleFile).toLocaleLowerCase() === '.strm'

    if (otherTaskFiles.has(fileKey)) {
      shared += 1
      logLines.push(`保留其他任务仍在引用的 STRM: ${relativeFile}`)
      continue
    }

    if (!isSafeTaskFile) {
      detached += 1
      logLines.push(`已移除历史或越界 STRM 索引（未删除磁盘文件）: ${staleFile}`)
      continue
    }

    try {
      await unlink(staleFile)
      deleted += 1
      affectedDirectories.add(path.dirname(staleFile))
      logLines.push(`已删除失效 STRM: ${relativeFile}`)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        missing += 1
        affectedDirectories.add(path.dirname(staleFile))
        logLines.push(`失效 STRM 已不存在，仅移除索引: ${relativeFile}`)
        continue
      }

      failed += 1
      retainedEntries.push(entry)
      logLines.push(`删除失效 STRM 失败: ${relativeFile} - ${getErrorMessage(error)}`)
    }
  }

  const removedDirectories = await pruneEmptyStrmDirectories(
    affectedDirectories,
    resolvedOutputDirectory,
    logLines,
  )
  logLines.push(
    `旧 STRM 清理完成：删除 ${deleted} 个，已不存在 ${missing} 个，移除历史索引 ${detached} 个，其他任务引用 ${shared} 个，失败 ${failed} 个，清理空目录 ${removedDirectories} 个。`,
  )

  return {
    deleted,
    detached,
    failed,
    missing,
    removedDirectories,
    retainedEntries,
    shared,
    stale: staleEntries.length,
  }
}

async function scanAndGenerateStrmEntries({
  logLines,
  outputDirectory,
  settings,
  storage,
  strmSettings,
  task,
}) {
  const pendingDirectories = [task.path || '/']
  const scanThreadCount = normalizeStrmThreadCount(strmSettings?.threadCount)
  const strmIndexEntries = []
  const strmUrlContext = {}
  const waiters = []
  let activeDirectories = 0
  let claimedDirectories = 0
  let scannedDirectories = 0
  let failedDirectories = 0
  let mediaFiles = 0
  let generated = 0
  let skipped = 0
  let failed = 0

  logLines.push('>>> 开始扫描并生成')

  function wakeWorkers() {
    while (waiters.length > 0) {
      waiters.shift()?.()
    }
  }

  function waitForDirectory() {
    return new Promise((resolve) => {
      waiters.push(resolve)
    })
  }

  function shouldStopScanning() {
    return claimedDirectories >= scanLimits.directories || mediaFiles >= scanLimits.mediaFiles
  }

  async function takeDirectory() {
    while (true) {
      if (shouldStopScanning()) {
        return undefined
      }

      const currentPath = pendingDirectories.shift()

      if (currentPath) {
        claimedDirectories += 1
        activeDirectories += 1
        return currentPath
      }

      if (activeDirectories === 0) {
        return undefined
      }

      await waitForDirectory()
    }
  }

  async function generateMediaEntry(entry) {
    mediaFiles += 1

    try {
      const result = await generateStrmForEntry({
        entry,
        outputDirectory,
        settings,
        storage,
        strmIndexEntries,
        strmSettings,
        strmUrlContext,
        task,
      })

      if (result.status === 'skipped') {
        skipped += 1
        logLines.push(`跳过已存在: ${result.relativeOutputFile}`)
      } else {
        generated += 1
        logLines.push(`生成成功: ${result.relativeOutputFile}`)
      }
    } catch (error) {
      failed += 1
      logLines.push(`生成失败: ${entry.path} - ${getErrorMessage(error)}`)
    }
  }

  async function scanWorker() {
    while (true) {
      const currentPath = await takeDirectory()

      if (!currentPath) {
        return
      }

      try {
        const result = await listAllStorageEntries(storage, currentPath)
        const mediaEntries = []
        scannedDirectories += 1
        logLines.push(`读取目录: ${result.path}`)

        for (const entry of result.entries) {
          if (entry.kind === 'folder') {
            pendingDirectories.push(entry.path)
          } else if (isMediaEntry(entry, strmSettings)) {
            mediaEntries.push(entry)
          }
        }

        wakeWorkers()

        for (const entry of mediaEntries) {
          if (mediaFiles >= scanLimits.mediaFiles) {
            break
          }

          await generateMediaEntry(entry)
        }
      } catch (error) {
        failedDirectories += 1
        logLines.push(`目录读取失败: ${currentPath} - ${getErrorMessage(error)}`)
      } finally {
        activeDirectories -= 1
        wakeWorkers()
      }
    }
  }

  await Promise.all(
    Array.from({ length: scanThreadCount }, () => {
      return scanWorker()
    }),
  )

  const scanLimitReached =
    claimedDirectories >= scanLimits.directories || mediaFiles >= scanLimits.mediaFiles

  if (scanLimitReached) {
    logLines.push('达到扫描上限，已停止继续递归。')
  }

  return {
    failedDirectories,
    failed,
    generated,
    mediaFiles,
    scanLimitReached,
    scannedDirectories,
    skipped,
    strmIndexEntries,
  }
}

function getTaskRunCompletionStatus(result = {}) {
  const failed = Math.max(0, Number(result.failed ?? 0) || 0)
  const failedDirectories = Math.max(0, Number(result.failedDirectories ?? 0) || 0)
  const generated = Math.max(0, Number(result.generated ?? 0) || 0)
  const skipped = Math.max(0, Number(result.skipped ?? 0) || 0)
  const mediaFiles = Math.max(0, Number(result.mediaFiles ?? 0) || 0)
  const scanLimitReached = result.scanLimitReached === true
  const completedMediaFiles = generated + skipped

  if (failed === 0 && failedDirectories === 0 && !scanLimitReached) {
    return 'succeeded'
  }

  if (
    failed === 0 &&
    generated === 0 &&
    skipped > 0 &&
    failedDirectories === 0 &&
    !scanLimitReached
  ) {
    return 'succeeded'
  }

  if (completedMediaFiles > 0 || mediaFiles > failed) {
    return 'partial'
  }

  return 'failed'
}

function formatPreStrmAiRenameResultLog(result = {}) {
  const action = String(result.action ?? '处理')
  const status = String(result.status ?? 'info')
  const sourcePath = String(result.oldPath ?? '').trim()
  const targetPath = String(result.newPath ?? '').trim()
  const pathText = targetPath
    ? `${sourcePath || '(未知源路径)'} -> ${targetPath}`
    : sourcePath
      ? sourcePath
      : ''

  return `[AI 重命名][${status}][${action}] ${String(result.message ?? '').trim()}${pathText ? ` | ${pathText}` : ''}`
}

async function scanAiRenameInventoryFingerprints(storage, taskPath, settings) {
  const scanJob = {
    abortController: new AbortController(),
    cancelRequested: false,
    currentPath: '',
    progress: { scanned: 0 },
  }
  const extensionSets = getRenameExtensionSets(settings.strm)
  const { entries } = await scanAiRenameTree(storage, taskPath, scanJob, extensionSets)

  return createAiRenameGroupRecords(entries, extensionSets).map((record) => record.fingerprint)
}

async function runPreStrmAiRename(task, storage, settings, logLines) {
  const aiSettings = normalizeAiRenameSettings(settings.aiRename)
  const configurationFingerprint = createAiRenameConfigurationFingerprint(aiSettings)
  let unchangedGroupFingerprints = []

  try {
    const incrementalState = await readAiRenameIncrementalState()
    const taskState = incrementalState[task.id]
    const canReuseState =
      taskState?.configurationFingerprint === configurationFingerprint &&
      taskState?.storageId === task.storageId &&
      taskState?.path === task.path &&
      Array.isArray(taskState?.groupFingerprints)

    if (canReuseState) {
      unchangedGroupFingerprints = taskState.groupFingerprints.map((fingerprint) =>
        String(fingerprint),
      )
      logLines.push(`AI 增量基线已加载：${unchangedGroupFingerprints.length} 个已处理视频目录。`)
    } else {
      logLines.push('AI 增量基线不存在或配置已变化，本次执行全量目录识别。')
    }
  } catch (error) {
    logLines.push(`读取 AI 增量基线失败，本次回退全量识别: ${getErrorMessage(error)}`)
  }

  const payload = {
    extraPrompt: '',
    path: task.path,
    recursive: true,
    storageId: task.storageId,
    unchangedGroupFingerprints,
    useTmdb: aiSettings.tmdbEnabled && Boolean(aiSettings.tmdbToken),
  }

  logLines.push('>>> 开始生成 STRM 前的 AI 重命名')
  logLines.push(
    `AI 预处理参数: 重建标准目录 ${aiSettings.rebuildFolders ? 'true' : 'false'}，TMDB 校验 ${payload.useTmdb ? 'true' : 'false'}`,
  )

  let job

  try {
    const createdJob = await createAiRenameJob(payload, { deferStart: true })
    job = aiRenameJobs.get(createdJob.id)

    if (!job) {
      throw new Error('AI 重命名任务创建后未找到运行实例')
    }

    let lastStageMessage = ''
    job.onProgress = (event) => {
      if (event.type === 'stage') {
        const stageMessage = `[AI 重命名][${event.stage}] ${event.message}`

        if (stageMessage !== lastStageMessage) {
          lastStageMessage = stageMessage
          logLines.push(stageMessage)
        }
        return
      }

      if (event.type === 'result') {
        logLines.push(formatPreStrmAiRenameResultLog(event.result))
      }
    }

    await runAiRenameJob(job, { ...payload, allowMove: job.allowMove })
  } catch (error) {
    logLines.push(`AI 重命名预处理启动或执行失败: ${getErrorMessage(error)}`)
    throw error
  } finally {
    if (job) {
      job.onProgress = undefined
    }
  }

  const result = getAiRenameJobForClient(job)
  const incrementalInventory = job.incrementalInventory ?? {
    currentFingerprints: [],
    inventoryGroups: 0,
    submittedGroups: 0,
    unchangedGroups: 0,
  }
  logLines.push(
    `AI 重命名预处理完成：状态 ${result.status}，成功 ${result.progress.succeeded}，跳过 ${result.progress.skipped}，失败 ${result.progress.failed}。`,
  )
  logLines.push(
    `AI 增量统计：视频目录 ${incrementalInventory.inventoryGroups} 个，提交 LLM ${incrementalInventory.submittedGroups} 个，未变化跳过 ${incrementalInventory.unchangedGroups} 个。`,
  )

  if (!['completed', 'partial'].includes(result.status)) {
    throw new Error(`AI 重命名预处理未成功完成：${result.message || result.status}`)
  }

  if (result.status === 'partial') {
    logLines.push('AI 重命名存在跳过或失败项目，将基于当前云盘状态继续生成 STRM。')
  }

  try {
    const groupFingerprints =
      incrementalInventory.submittedGroups === 0
        ? incrementalInventory.currentFingerprints
        : await scanAiRenameInventoryFingerprints(storage, task.path, settings)
    await saveAiRenameIncrementalTaskState(task.id, {
      configurationFingerprint,
      groupFingerprints: [...new Set(groupFingerprints)].sort(),
      path: task.path,
      storageId: task.storageId,
      updatedAt: new Date().toISOString(),
    })
    logLines.push(
      `AI 增量基线已更新：${groupFingerprints.length} 个视频目录；下次仅提交新增或变化目录。`,
    )
  } catch (error) {
    logLines.push(`更新 AI 增量基线失败，下次将重新识别: ${getErrorMessage(error)}`)
  }

  logLines.push('------------------------------------------------------------')
  result.incrementalInventory = incrementalInventory
  return result
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
    `生成前 AI 重命名: ${task.aiRenameBeforeStrm ? 'true' : 'false'}`,
    `预先刷新 OpenList 缓存: ${task.preRefreshOpenListCache ? 'true' : 'false'}`,
    `直链签名: ${shouldAppendAListSign(storage) ? 'true' : 'false'}`,
    `STRM 中转: ${shouldUseStrmRedirect(storage) ? 'true' : 'false'}`,
    `媒体后缀: ${strmSettings.mediaExtensions}`,
    `媒体大小阈值: ${strmSettings.minMediaSizeMb} MB`,
    `扫描线程数量: ${normalizeStrmThreadCount(strmSettings.threadCount)}`,
    '------------------------------------------------------------',
  ])

  await mkdir(outputDirectory, { recursive: true })

  let aiRenameResult

  if (task.aiRenameBeforeStrm) {
    aiRenameResult = await runPreStrmAiRename(task, storage, settings, logLines)
  }

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

  let previousIndexEntries = []
  let previousIndexAvailable = true

  try {
    previousIndexEntries = await readStrmIndex()
  } catch (error) {
    previousIndexAvailable = false
    logLines.push(`读取旧 STRM 索引失败，将跳过失效文件清理: ${getErrorMessage(error)}`)
  }

  let {
    failedDirectories,
    failed,
    generated,
    mediaFiles,
    scanLimitReached,
    scannedDirectories,
    skipped,
    strmIndexEntries,
  } = await scanAndGenerateStrmEntries({
    logLines,
    outputDirectory,
    settings,
    storage,
    strmSettings,
    task,
  })

  let cleanupDeleted = 0
  let cleanupDetached = 0
  let cleanupFailed = 0
  let cleanupMissing = 0
  let cleanupRemovedDirectories = 0
  let cleanupShared = 0
  let cleanupSkipped = false

  if (
    previousIndexAvailable &&
    failed === 0 &&
    failedDirectories === 0 &&
    scanLimitReached !== true
  ) {
    try {
      previousIndexEntries = await readStrmIndex()
    } catch (error) {
      previousIndexAvailable = false
      logLines.push(`重新读取旧 STRM 索引失败，将跳过失效文件清理: ${getErrorMessage(error)}`)
    }
  }

  const cleanupAllowed =
    previousIndexAvailable && failed === 0 && failedDirectories === 0 && scanLimitReached !== true

  if (cleanupAllowed) {
    const cleanupResult = await cleanupStaleStrmFiles({
      currentIndexEntries: strmIndexEntries,
      logLines,
      outputDirectory,
      previousIndexEntries,
      task,
    })
    cleanupDeleted = cleanupResult.deleted
    cleanupDetached = cleanupResult.detached
    cleanupFailed = cleanupResult.failed
    cleanupMissing = cleanupResult.missing
    cleanupRemovedDirectories = cleanupResult.removedDirectories
    cleanupShared = cleanupResult.shared
    failed += cleanupFailed

    try {
      await replaceStrmIndexEntriesForTask(task.id, [
        ...strmIndexEntries,
        ...cleanupResult.retainedEntries,
      ])
      logLines.push(
        `已同步 STRM 索引: 当前 ${strmIndexEntries.length} 条，保留清理失败 ${cleanupResult.retainedEntries.length} 条`,
      )
    } catch (error) {
      failed += 1
      logLines.push(`同步 STRM 索引失败: ${getErrorMessage(error)}`)
    }
  } else {
    cleanupSkipped = true
    const reasons = [
      !previousIndexAvailable ? '旧索引不可用' : '',
      failedDirectories > 0 ? `${failedDirectories} 个目录读取失败` : '',
      failed > 0 ? `${failed} 个文件生成失败` : '',
      scanLimitReached ? '达到扫描上限' : '',
    ].filter(Boolean)
    logLines.push(`跳过旧 STRM 清理：${reasons.join('、') || '本次扫描不完整'}。`)

    try {
      await upsertStrmIndexEntries(strmIndexEntries)
      logLines.push(`已增量更新 STRM 索引: ${strmIndexEntries.length} 条`)
    } catch (error) {
      failed += 1
      logLines.push(`更新 STRM 索引失败: ${getErrorMessage(error)}`)
    }
  }

  const finishedAt = new Date()
  const strmStatus = getTaskRunCompletionStatus({
    failed,
    failedDirectories,
    generated,
    mediaFiles,
    scanLimitReached,
    skipped,
  })
  const status =
    aiRenameResult?.status === 'partial' && strmStatus === 'succeeded' ? 'partial' : strmStatus
  const ok = status === 'succeeded'
  const partial = status === 'partial'

  logLines.push(
    `生成完成，共发现 ${mediaFiles} 个媒体文件，生成 ${generated} 个，跳过 ${skipped} 个，失败 ${failed} 个，目录读取失败 ${failedDirectories} 个，清理失效 STRM ${cleanupDeleted} 个。`,
  )
  logLines.push(`${formatLocalDateTime(finishedAt)} 任务完成`)
  logLines.finish(status)

  return {
    log: logLines.text(),
    result: {
      cleanupDeleted,
      cleanupDetached,
      cleanupFailed,
      cleanupMissing,
      cleanupRemovedDirectories,
      cleanupShared,
      cleanupSkipped,
      aiRenameFailed: aiRenameResult?.progress.failed ?? 0,
      aiRenameInventoryGroups: aiRenameResult?.incrementalInventory?.inventoryGroups ?? 0,
      aiRenameSkipped: aiRenameResult?.progress.skipped ?? 0,
      aiRenameStatus: aiRenameResult?.status ?? 'skipped',
      aiRenameSubmittedGroups: aiRenameResult?.incrementalInventory?.submittedGroups ?? 0,
      aiRenameSucceeded: aiRenameResult?.progress.succeeded ?? 0,
      aiRenameUnchangedGroups: aiRenameResult?.incrementalInventory?.unchangedGroups ?? 0,
      failed,
      failedDirectories,
      finishedAt: finishedAt.toISOString(),
      generated,
      mediaFiles,
      ok,
      outputPath,
      partial,
      scanLimitReached,
      scannedDirectories,
      skipped,
      startedAt: startedAt.toISOString(),
      status,
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

  const nextStatus = normalizeTaskStatus(
    execution.result.status ?? (execution.result.ok ? 'succeeded' : 'failed'),
  )
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

  if (nextStatus !== 'failed') {
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

async function redirectStrmTarget(request, response) {
  const route = getStrmRedirectRoute(request.url)

  if (!route) {
    sendJson(response, 404, {
      ok: false,
      title: 'Not Found',
      message: 'STRM 中转接口不存在',
    })
    return
  }

  try {
    const storages = await readStorages()
    const storage = storages.find((item) => item.id === route.storageId)

    if (!storage || !shouldUseStrmRedirect(storage)) {
      throw new Error('未找到可用的 STRM 中转存储')
    }

    const targetUrl = await createStrmUrl(storage, route.remotePath, {})

    redirectTo(response, targetUrl)
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      title: 'STRM 中转失败',
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

function getStrmRedirectSourcePathFromUrl(rawUrl, storage) {
  try {
    const route = getStrmRedirectRoute(rawUrl)

    if (route?.storageId === storage.id) {
      return route.remotePath
    }
  } catch {
    return ''
  }

  return ''
}

function getStorageSourcePathFromTarget(storage, target) {
  const redirectSourcePath = getStrmRedirectSourcePathFromUrl(target, storage)

  if (redirectSourcePath) {
    return redirectSourcePath
  }

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
    getStrmRedirectRoute(request.url)
  ) {
    await redirectStrmTarget(request, response)
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

  try {
    if (await requireApiAccessIfExternal(request, response)) {
      return
    }
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      title: 'API 秘钥校验失败',
      message: getErrorMessage(error),
    })
    return
  }

  if (request.method === 'GET' && request.url === '/api/access') {
    try {
      sendJson(response, 200, await ensureApiAccessKey(getRequestOrigin(request)))
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        title: '读取 API 秘钥失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'PUT' && request.url === '/api/access') {
    try {
      const values = await readJsonBody(request)
      sendJson(response, 200, await updateApiAccessSettings(values, getRequestOrigin(request)))
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '保存 API 接口设置失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/access/regenerate') {
    try {
      sendJson(response, 200, await regenerateApiAccessKey(getRequestOrigin(request)))
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '重置 API 秘钥失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'GET' && request.url === '/api/settings') {
    try {
      const settings = await readSettings(getRequestOrigin(request))
      settings.aiRename = getAiRenameSettingsForClient(settings.aiRename)
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

  if (request.method === 'PUT' && request.url === '/api/settings/ai-rename') {
    try {
      const values = await readJsonBody(request)
      sendJson(response, 200, await saveAiRenameSettings(values, getRequestOrigin(request)))
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '保存 AI 重命名设置失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/ai-rename/test') {
    try {
      const values = await readJsonBody(request)
      sendJson(response, 200, await testAiRenameConnection(values, getRequestOrigin(request)))
    } catch (error) {
      sendJson(response, error?.statusCode ?? 400, {
        ok: false,
        title: 'AI 重命名接口测试失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/ai-rename/models') {
    try {
      const values = await readJsonBody(request)
      sendJson(response, 200, await discoverAiRenameModels(values, getRequestOrigin(request)))
    } catch (error) {
      sendJson(response, error?.statusCode ?? 400, {
        ok: false,
        title: 'AI 模型探测失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/ai-rename/tmdb/test') {
    try {
      const values = await readJsonBody(request)
      sendJson(response, 200, await testTmdbConnection(values, getRequestOrigin(request)))
    } catch (error) {
      sendJson(response, error?.statusCode ?? 400, {
        ok: false,
        title: 'TMDB 连接测试失败',
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

  if (request.method === 'PUT' && request.url === '/api/strm-assistant/plugin-settings') {
    try {
      const values = await readJsonBody(request)
      sendJson(
        response,
        200,
        await updateStrmAssistantPluginSettings(values, getRequestOrigin(request)),
      )
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '同步神医助手插件参数失败',
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
      const values = await readJsonBody(request)
      sendJson(
        response,
        200,
        await startStrmAssistant(getRequestOrigin(request), {
          forceReplace: values?.forceReplace === true,
        }),
      )
    } catch (error) {
      sendJson(response, error?.statusCode ?? 400, {
        ok: false,
        title: error?.title ?? '启动神医助手失败',
        message: getErrorMessage(error),
        replacementRequired: error?.replacementRequired === true,
      })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/emby-plugin/install') {
    try {
      const values = await readJsonBody(request)
      sendJson(
        response,
        200,
        await installEmbyPlugin(getRequestOrigin(request), {
          forceReplace: values?.forceReplace === true,
        }),
      )
    } catch (error) {
      sendJson(response, error?.statusCode ?? 400, {
        ok: false,
        title: error?.title ?? '安装 Emby 插件失败',
        message: getErrorMessage(error),
        replacementRequired: error?.replacementRequired === true,
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

  if (request.method === 'POST' && request.url === '/api/storage/ai-rename/jobs') {
    try {
      const payload = await readJsonBody(request)
      sendJson(response, 202, await createAiRenameJob(payload))
    } catch (error) {
      sendJson(response, error?.statusCode ?? 400, {
        ok: false,
        title: '创建 AI 重命名任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'GET' && request.url === '/api/ai-rename/tasks') {
    try {
      sendJson(response, 200, await readAiRenameTasksForClient())
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        title: '读取 AI 重命名任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/ai-rename/tasks/run-all') {
    try {
      sendJson(response, 200, await runAllAiRenameTasks())
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '运行全部 AI 重命名任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  const aiRenameTaskRoute = getAiRenameTaskRoute(request.url)

  if (request.method === 'PUT' && aiRenameTaskRoute && !aiRenameTaskRoute.action) {
    try {
      const values = await readJsonBody(request)
      sendJson(response, 200, await saveAiRenameTask(aiRenameTaskRoute.taskId, values))
    } catch (error) {
      sendJson(response, error?.statusCode ?? 400, {
        ok: false,
        title: '保存 AI 重命名任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'DELETE' && aiRenameTaskRoute && !aiRenameTaskRoute.action) {
    try {
      sendJson(response, 200, {
        deleted: await deleteAiRenameTask(aiRenameTaskRoute.taskId),
        ok: true,
      })
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '删除 AI 重命名任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && aiRenameTaskRoute?.action === 'run') {
    try {
      sendJson(response, 202, await runAiRenameTask(aiRenameTaskRoute.taskId))
    } catch (error) {
      sendJson(response, error?.statusCode ?? 400, {
        ok: false,
        title: '运行 AI 重命名任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'POST' && aiRenameTaskRoute?.action === 'stop') {
    try {
      sendJson(response, 200, await stopAiRenameTask(aiRenameTaskRoute.taskId))
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        title: '停止 AI 重命名任务失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  if (request.method === 'GET' && aiRenameTaskRoute?.action === 'result') {
    try {
      sendJson(response, 200, await getAiRenameTaskResult(aiRenameTaskRoute.taskId))
    } catch (error) {
      sendJson(response, 404, {
        ok: false,
        title: '读取 AI 重命名任务结果失败',
        message: getErrorMessage(error),
      })
    }
    return
  }

  const aiRenameJobRoute = getAiRenameJobRoute(request.url)

  if (request.method === 'GET' && aiRenameJobRoute && !aiRenameJobRoute.action) {
    const job = aiRenameJobs.get(aiRenameJobRoute.jobId)

    if (!job) {
      sendJson(response, 404, {
        ok: false,
        title: '未找到 AI 重命名任务',
        message: '任务可能因服务重启而失效。',
      })
    } else {
      sendJson(response, 200, getAiRenameJobForClient(job))
    }
    return
  }

  if (request.method === 'POST' && aiRenameJobRoute?.action === 'cancel') {
    try {
      sendJson(response, 200, cancelAiRenameJob(aiRenameJobRoute.jobId))
    } catch (error) {
      sendJson(response, 404, {
        ok: false,
        title: '停止 AI 重命名任务失败',
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

try {
  await ensureApiAccessKey()
} catch (error) {
  console.error(`OpenStrmBridge API access key initialization failed: ${getErrorMessage(error)}`)
}

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
