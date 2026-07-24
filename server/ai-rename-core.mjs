import path from 'node:path'

const supportedNamingStyles = new Set(['zh-en', 'en-zh', 'zh', 'en'])

export function resolveAiRenameJobStatus(progress = {}) {
  const failed = Number(progress.failed ?? 0)
  const ignored = Number(progress.ignored ?? 0)
  const skipped = Number(progress.skipped ?? 0)
  const succeeded = Number(progress.succeeded ?? 0)

  if (failed > 0) {
    return succeeded > 0 || skipped > 0 || ignored > 0 ? 'partial' : 'failed'
  }

  return 'completed'
}

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

export const defaultSubtitleExtensions = ['ass', 'ssa', 'srt', 'sub', 'vtt']

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

export function isSubtitleFileName(fileName) {
  return defaultSubtitleExtensions.includes(getLowerExtension(fileName))
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
  if (!series || typeof series !== 'object' || Array.isArray(series)) {
    series = {}
  }

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

export function renderMovieFileName(movie, originalName, namingStyle) {
  const extension = path.posix.extname(String(originalName ?? '').replaceAll('\\', '/'))
  const title = formatSeriesTitle(
    {
      ...movie,
      namingStyle: movie?.namingStyle ?? namingStyle,
    },
    true,
  )

  if (!title || !extension) {
    return ''
  }

  const versionLabel = sanitizeNameSegment(movie?.versionLabel)
  const edition = sanitizeNameSegment(movie?.edition)
  const version = sanitizeNameSegment(movie?.version)
  const selectedVersion =
    versionLabel ||
    [edition, version]
      .filter((value, index, values) => {
        return (
          value &&
          values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index
        )
      })
      .join(' ')
  const part = sanitizeNameSegment(movie?.part)
  const suffix = [selectedVersion, part].filter(Boolean).join('-')

  return `${title}${suffix ? ` - ${suffix}` : ''}${extension}`
}

export function extractMovieVersionLabel(originalName) {
  const parsed = path.posix.parse(String(originalName ?? '').replaceAll('\\', '/'))
  const source = parsed.name
  const normalized = source
    .normalize('NFKC')
    .replace(/[._[\](){}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const labels = []
  const add = (label) => {
    const sanitized = sanitizeNameSegment(label)

    if (!sanitized || labels.some((item) => item.toLowerCase() === sanitized.toLowerCase())) {
      return
    }

    labels.push(sanitized)
  }
  const editionPatterns = [
    ['Directors Cut', /\b(?:director'?s|directors)\s+cut\b|导演剪辑/i],
    ['Extended', /\bextended(?:\s+(?:cut|edition))?\b|加长版?/i],
    ['Remastered', /\bremaster(?:ed)?\b|重制版?/i],
    ['Theatrical', /\btheatrical(?:\s+cut)?\b|剧场版/i],
    ['Unrated', /\bunrated\b|未分级|未删减/i],
    ['Final Cut', /\bfinal\s+cut\b/i],
    ['Open Matte', /\bopen\s+matte\b/i],
    ['IMAX', /\bimax\b/i],
    ['3D', /\b(?:3d|hsbs|hou)\b/i],
  ]

  for (const [label, pattern] of editionPatterns) {
    if (pattern.test(normalized)) add(label)
  }

  const resolution = normalized.match(/\b(4320|2160|1440|1080|720|576|480)\s*([pi])\b/i)

  if (resolution) {
    add(`${resolution[1]}${resolution[2].toLowerCase()}`)
  } else if (/\b8k\b/i.test(normalized)) {
    add('8K')
  } else if (/\b4k\b/i.test(normalized)) {
    add('4K')
  }

  if (/\b(?:dolby\s*vision|dovi|dv)\b/i.test(normalized)) add('DV')
  if (/\bhdr10\s*\+|\bhdr10plus\b/i.test(normalized)) {
    add('HDR10+')
  } else if (/\bhdr10\b/i.test(normalized)) {
    add('HDR10')
  } else if (/\bhdr\b/i.test(normalized)) {
    add('HDR')
  } else if (/\bsdr\b/i.test(normalized)) {
    add('SDR')
  }

  if (/\b(?:bd\s*)?remux\b/i.test(normalized)) {
    add('Remux')
  } else if (/\bblu\s*ray\b|\bbluray\b|\bbdrip\b/i.test(normalized)) {
    add('BluRay')
  } else if (/\bweb\s*-?\s*dl\b|\bwebdl\b/i.test(normalized)) {
    add('WEB-DL')
  } else if (/\bweb\s*-?\s*rip\b|\bwebrip\b/i.test(normalized)) {
    add('WEBRip')
  } else if (/\bhdtv\b/i.test(normalized)) {
    add('HDTV')
  }

  if (/\bav1\b/i.test(normalized)) {
    add('AV1')
  } else if (/\b(?:h\s*\.?\s*265|x265|hevc)\b/i.test(normalized)) {
    add('H.265')
  } else if (/\b(?:h\s*\.?\s*264|x264|avc)\b/i.test(normalized)) {
    add('H.264')
  }

  if (/\batmos\b/i.test(normalized)) add('Atmos')
  if (/\btruehd\b/i.test(normalized)) add('TrueHD')
  if (/\bdts\s*-?\s*x\b/i.test(normalized)) add('DTS-X')
  if (/\bdts\s*-?\s*hd(?:\s*ma)?\b/i.test(normalized)) add('DTS-HD MA')

  const releaseGroup = source.match(/-([A-Za-z0-9]{2,30})$/)?.[1]

  if (releaseGroup && !/^(?:cd|disc|disk|part|pt)\d+$/i.test(releaseGroup)) {
    add(releaseGroup.replace(/[._]+/g, ' '))
  }

  return labels.slice(0, 7).join(' ')
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

function getFileStem(fileName) {
  const parsed = path.posix.parse(String(fileName ?? '').replaceAll('\\', '/'))
  return parsed.name
}

function normalizeFileStem(fileName) {
  return getFileStem(fileName).normalize('NFKC').toLocaleLowerCase()
}

function isSubtitleQualifierToken(value) {
  return /^(?:zh(?:[-_](?:cn|tw|hk|sg|hans|hant))?|zho|chi|chs|cht|sc|tc|cn|简体|繁体|简中|繁中|中字|双语|中英|en|eng|english|ja|jpn|jp|japanese|ko|kor|kr|korean|forced|foreign|default|sdh|hi|cc)$/i.test(
    String(value ?? '').trim(),
  )
}

function getTrailingSubtitleQualifier(subtitleStem) {
  const parts = String(subtitleStem ?? '').split('.')
  let qualifierStart = parts.length

  while (qualifierStart > 0 && isSubtitleQualifierToken(parts[qualifierStart - 1])) {
    qualifierStart -= 1
  }

  return qualifierStart < parts.length ? parts.slice(qualifierStart).join('.') : ''
}

function normalizeSubtitleQualifier(value) {
  const qualifier = sanitizeNameSegment(value)
    .replace(/^[\s._-]+/g, '')
    .replace(/\s+/g, '-')

  return qualifier ? `.${qualifier}` : ''
}

export function getSubtitleQualifier(subtitleName, mediaName) {
  const subtitleStem = getFileStem(subtitleName)
  const mediaStem = getFileStem(mediaName)
  const normalizedSubtitleStem = subtitleStem.normalize('NFKC').toLocaleLowerCase()
  const normalizedMediaStem = mediaStem.normalize('NFKC').toLocaleLowerCase()

  if (normalizedSubtitleStem === normalizedMediaStem) {
    return ''
  }

  if (
    normalizedMediaStem &&
    normalizedSubtitleStem.startsWith(normalizedMediaStem) &&
    /^[\s._\-[({（【]/.test(subtitleStem.slice(mediaStem.length))
  ) {
    return normalizeSubtitleQualifier(subtitleStem.slice(mediaStem.length))
  }

  return normalizeSubtitleQualifier(getTrailingSubtitleQualifier(subtitleStem))
}

function getEpisodeIdentity(value) {
  const stem = getFileStem(value).normalize('NFKC')
  const seasonEpisode = stem.match(/\bS(\d{1,3})[.\s_-]*E(\d{1,4}(?:[.\s_-]*(?:-|E)\s*\d{1,4})*)/i)

  if (seasonEpisode) {
    return `s${Number.parseInt(seasonEpisode[1], 10)}e${seasonEpisode[2]
      .replace(/\D+/g, ',')
      .replace(/^,|,$/g, '')}`
  }

  const episode = stem.match(/(?:^|[.\s_-])E(?:P)?[.\s_-]*(\d{1,4})(?:$|[.\s_-])/i)
  return episode ? `e${Number.parseInt(episode[1], 10)}` : ''
}

export function matchSubtitleToMedia(subtitleEntry, mediaEntries = []) {
  const candidates = mediaEntries.filter((entry) => entry?.name)

  if (!subtitleEntry?.name || candidates.length === 0) {
    return undefined
  }

  const subtitleStem = normalizeFileStem(subtitleEntry.name)
  const subtitleComparable = normalizeComparableTitle(getFileStem(subtitleEntry.name))
  const subtitleEpisode = getEpisodeIdentity(subtitleEntry.name)
  const ranked = candidates
    .map((entry) => {
      const mediaStem = normalizeFileStem(entry.name)
      const mediaComparable = normalizeComparableTitle(getFileStem(entry.name))
      const mediaEpisode = getEpisodeIdentity(entry.name)
      let score = 0

      if (subtitleStem === mediaStem) {
        score = 100_000 + mediaStem.length
      } else if (
        mediaStem &&
        subtitleStem.startsWith(mediaStem) &&
        /^[\s._\-[({（【]/.test(
          getFileStem(subtitleEntry.name).slice(getFileStem(entry.name).length),
        )
      ) {
        score = 90_000 + mediaStem.length
      } else if (subtitleComparable && subtitleComparable === mediaComparable) {
        score = 80_000 + mediaComparable.length
      } else if (subtitleEpisode && subtitleEpisode === mediaEpisode) {
        score = 70_000 + mediaStem.length
      }

      return { entry, score }
    })
    .filter(({ score }) => score > 0)
    .sort((first, second) => second.score - first.score)

  if (ranked.length > 0 && (ranked.length === 1 || ranked[0].score > ranked[1].score)) {
    return ranked[0].entry
  }

  return candidates.length === 1 ? candidates[0] : undefined
}

export function renderSubtitleFileName(targetMediaName, subtitleName, sourceMediaName) {
  const mediaExtension = path.posix.extname(String(targetMediaName ?? '').replaceAll('\\', '/'))
  const subtitleExtension = path.posix.extname(String(subtitleName ?? '').replaceAll('\\', '/'))

  if (!mediaExtension || !subtitleExtension || !isSubtitleFileName(subtitleName)) {
    return ''
  }

  const mediaStem = String(targetMediaName).slice(0, -mediaExtension.length)
  const qualifier = getSubtitleQualifier(subtitleName, sourceMediaName)
  return `${mediaStem}${qualifier}${subtitleExtension}`
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

  const rawMediaType = String(payload.mediaType ?? payload.type ?? '')
    .trim()
    .toLowerCase()
  const movieItems = items.filter((item) => item.role === 'movie')
  const mediaType =
    rawMediaType === 'movie-collection' || rawMediaType === 'movie_collection'
      ? 'movie-collection'
      : rawMediaType === 'movie' || rawMediaType === 'film'
        ? 'movie'
        : movieItems.length > 0
          ? movieItems.length > 1
            ? 'movie-collection'
            : 'movie'
          : 'tv'
  const series = normalizeSeriesMetadata(payload.series)

  if (mediaType === 'tv' && !series.titleZh && !series.titleOriginal) {
    throw new Error('AI 未识别出剧名')
  }

  if (
    mediaType !== 'tv' &&
    !movieItems.some((item) => {
      const movie = normalizeSeriesMetadata(item)
      return movie.titleZh || movie.titleOriginal
    })
  ) {
    throw new Error('AI 未识别出电影名')
  }

  return {
    items,
    mediaType,
    series,
  }
}

export function normalizeComparableTitle(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s._'"()（）·:：,，-]+/g, '')
}
