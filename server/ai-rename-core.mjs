import path from 'node:path'

const supportedNamingStyles = new Set(['zh-en', 'en-zh', 'zh', 'en'])

export function normalizeNamingStyle(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()

  return supportedNamingStyles.has(normalized) ? normalized : 'zh-en'
}

export const defaultMediaExtensions = [
  'mp4',
  'mkv',
  'mov',
  'avi',
  'flv',
  'm4v',
  'ts',
  'wmv',
  'webm',
]

export const defaultSidecarExtensions = [
  'nfo',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'ass',
  'ssa',
  'srt',
  'sub',
  'vtt',
]

function parseExtensionList(value, defaults) {
  const values = String(value ?? '')
    .split(',')
    .map((item) => item.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean)

  return new Set(values.length > 0 ? values : defaults)
}

export function getRenameExtensionSets(strmSettings = {}) {
  return {
    media: parseExtensionList(strmSettings.mediaExtensions, defaultMediaExtensions),
    sidecar: parseExtensionList(strmSettings.sidecarExtensions, defaultSidecarExtensions),
  }
}

export function getLowerExtension(fileName) {
  return path.posix
    .extname(String(fileName ?? '').replaceAll('\\', '/'))
    .slice(1)
    .toLowerCase()
}

export function isMediaFileName(fileName, extensionSets) {
  return extensionSets.media.has(getLowerExtension(fileName))
}

export function isSidecarFileName(fileName, extensionSets) {
  return extensionSets.sidecar.has(getLowerExtension(fileName))
}

export function sanitizeNameSegment(value) {
  return Array.from(String(value ?? ''))
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 31 && codePoint !== 127
    })
    .join('')
    .replace(/[\\/]/g, ' ')
    .replace(/[<>:"|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
}

export function isValidRenameBasename(value) {
  const name = String(value ?? '')
  const containsControlCharacter = Array.from(name).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })

  return Boolean(
    name &&
    name !== '.' &&
    name !== '..' &&
    name.length <= 240 &&
    !containsControlCharacter &&
    !/[\\/]/.test(name),
  )
}

export function normalizeSeriesMetadata(series = {}) {
  const titleZh = sanitizeNameSegment(series.titleZh || series.titleCn || series.chineseTitle)
  const titleOriginal = sanitizeNameSegment(
    series.titleOriginal || series.originalTitle || series.titleEn || series.englishTitle,
  )
  const rawYear = Number.parseInt(String(series.year ?? ''), 10)
  const year = Number.isFinite(rawYear) && rawYear >= 1800 && rawYear <= 2200 ? rawYear : undefined
  const rawSeason = Number.parseInt(String(series.season ?? ''), 10)
  const season = Number.isFinite(rawSeason) && rawSeason >= 0 ? rawSeason : undefined

  return {
    namingStyle: normalizeNamingStyle(series.namingStyle),
    season,
    titleOriginal: titleOriginal || titleZh,
    titleZh: titleZh || titleOriginal,
    year,
  }
}

export function formatSeriesTitle(series, includeYear = true) {
  const normalized = normalizeSeriesMetadata(series)
  const titlesDiffer =
    normalized.titleZh &&
    normalized.titleOriginal &&
    normalized.titleZh.toLocaleLowerCase() !== normalized.titleOriginal.toLocaleLowerCase()
  let selectedTitle

  if (normalized.namingStyle === 'zh') {
    selectedTitle = normalized.titleZh || normalized.titleOriginal
  } else if (normalized.namingStyle === 'en') {
    selectedTitle = normalized.titleOriginal || normalized.titleZh
  } else if (normalized.namingStyle === 'en-zh' && titlesDiffer) {
    selectedTitle = `${normalized.titleOriginal} (${normalized.titleZh})`
  } else if (normalized.namingStyle === 'zh-en' && titlesDiffer) {
    selectedTitle = `${normalized.titleZh} (${normalized.titleOriginal})`
  } else {
    selectedTitle = normalized.titleZh || normalized.titleOriginal
  }

  if (!selectedTitle) {
    return ''
  }

  return includeYear && normalized.year ? `${selectedTitle} (${normalized.year})` : selectedTitle
}

export function formatSeasonDirectory(season) {
  const parsed = Number.parseInt(String(season ?? ''), 10)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return ''
  }

  return `Season ${String(parsed).padStart(2, '0')}`
}

function normalizeEpisodeNumbers(value) {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]

  return values
    .map((item) => Number.parseInt(String(item), 10))
    .filter((item) => Number.isFinite(item) && item >= 0)
}

export function formatEpisodeToken(item = {}) {
  const season = Number.parseInt(String(item.season ?? ''), 10)
  const episodes = normalizeEpisodeNumbers(item.episodes ?? item.episode)

  if (!Number.isFinite(season) || season < 0 || episodes.length === 0) {
    return ''
  }

  const seasonToken = `S${String(season).padStart(2, '0')}`
  const episodeToken = episodes
    .map((episode, index) => `${index === 0 ? 'E' : '-E'}${String(episode).padStart(2, '0')}`)
    .join('')
  const version = sanitizeNameSegment(item.version).replace(/^\s+/, '')
  const part = sanitizeNameSegment(item.part)

  return `${seasonToken}${episodeToken}${version}${part ? `-${part}` : ''}`
}

export function renderEpisodeFileName(series, item, originalName) {
  const extension = path.posix.extname(String(originalName ?? '').replaceAll('\\', '/'))
  const title = formatSeriesTitle(series, false)
  const episodeToken = formatEpisodeToken(item)

  if (!title || !episodeToken || !extension) {
    return ''
  }

  return `${title} - ${episodeToken}${extension}`
}

export function renderFolderName(series, item, isTopLevel) {
  const role = String(item?.role ?? '').toLowerCase()
  const season = item?.season ?? series?.season

  if (role === 'series-folder') {
    return formatSeriesTitle(series, true)
  }

  if (role === 'season-folder') {
    const seasonDirectory = formatSeasonDirectory(season)

    if (!seasonDirectory) {
      return ''
    }

    return isTopLevel ? `${formatSeriesTitle(series, true)} - ${seasonDirectory}` : seasonDirectory
  }

  return ''
}

export function renderSidecarFileName(series, item, originalName, mediaNamesById = new Map()) {
  const extension = path.posix.extname(String(originalName ?? '').replaceAll('\\', '/'))
  const role = String(item?.role ?? '').toLowerCase()
  const sidecarRole = String(item?.sidecarRole ?? '').toLowerCase()
  const mediaName = item?.sidecarFor ? mediaNamesById.get(String(item.sidecarFor)) : ''

  if (mediaName) {
    const mediaStem = mediaName.slice(0, -path.posix.extname(mediaName).length)
    const language = sanitizeNameSegment(item.language).replace(/\s+/g, '-')
    const forced = item.forced === true ? '.forced' : ''
    const hearingImpaired = item.hearingImpaired === true ? '.sdh' : ''

    return `${mediaStem}${language ? `.${language}` : ''}${forced}${hearingImpaired}${extension}`
  }

  const effectiveRole = sidecarRole || role

  if (effectiveRole === 'poster') {
    return `poster${extension}`
  }

  if (effectiveRole === 'fanart') {
    return `fanart${extension}`
  }

  if (effectiveRole === 'tvshow-nfo') {
    return 'tvshow.nfo'
  }

  if (effectiveRole === 'season-nfo') {
    return 'season.nfo'
  }

  if (effectiveRole === 'season-poster') {
    const season = Number.parseInt(String(item.season ?? series?.season ?? ''), 10)
    return Number.isFinite(season)
      ? `season${String(season).padStart(2, '0')}-poster${extension}`
      : ''
  }

  return ''
}

export function parseAiJsonContent(content) {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return content
  }

  const text = String(content ?? '').trim()

  if (!text) {
    throw new Error('AI 未返回内容')
  }

  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(withoutFence)
  } catch {
    const start = withoutFence.indexOf('{')
    const end = withoutFence.lastIndexOf('}')

    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1))
    }

    throw new Error('AI 返回的内容不是有效 JSON')
  }
}

export function normalizeAiClassification(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('AI 返回结构无效')
  }

  const series = normalizeSeriesMetadata(payload.series)

  if (!series.titleZh && !series.titleOriginal) {
    throw new Error('AI 未识别出剧名')
  }

  const items = Array.isArray(payload.items)
    ? payload.items
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => ({
          ...item,
          id: String(item.id ?? '').trim(),
          role: String(item.role ?? '')
            .trim()
            .toLowerCase(),
        }))
        .filter((item) => item.id)
    : []

  return {
    items,
    series,
  }
}

export function normalizeComparableTitle(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s._'"()（）·:：,，-]+/g, '')
}
