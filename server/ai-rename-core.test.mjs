import { describe, expect, it } from 'vitest'

import {
  extractMovieVersionLabel,
  formatEpisodeToken,
  formatSeriesTitle,
  getSubtitleQualifier,
  isSubtitleFileName,
  isValidRenameBasename,
  matchSubtitleToMedia,
  normalizeAiClassification,
  parseAiJsonContent,
  renderEpisodeFileName,
  renderFolderName,
  renderMovieFileName,
  renderSidecarFileName,
  renderSubtitleFileName,
  resolveAiRenameJobStatus,
  sanitizeNameSegment,
} from './ai-rename-core.mjs'

const rickAndMorty = {
  season: 6,
  titleOriginal: 'Rick and Morty',
  titleZh: '瑞克和莫蒂',
  year: 2013,
}

describe('AI rename job outcome', () => {
  it('treats skipped-only work as completed instead of failed', () => {
    expect(resolveAiRenameJobStatus({ failed: 0, ignored: 125, skipped: 6, succeeded: 0 })).toBe(
      'completed',
    )
  })

  it('distinguishes completed, partially failed and fully failed work', () => {
    expect(resolveAiRenameJobStatus({ failed: 0, ignored: 8, skipped: 0, succeeded: 0 })).toBe(
      'completed',
    )
    expect(resolveAiRenameJobStatus({ failed: 1, ignored: 8, skipped: 0, succeeded: 0 })).toBe(
      'partial',
    )
    expect(resolveAiRenameJobStatus({ failed: 2, ignored: 0, skipped: 0, succeeded: 0 })).toBe(
      'failed',
    )
  })
})

describe('AI rename deterministic naming', () => {
  it('renders bilingual series, season and episode names', () => {
    expect(formatSeriesTitle(rickAndMorty)).toBe('瑞克和莫蒂 (Rick and Morty) (2013)')
    expect(renderFolderName(rickAndMorty, { role: 'season-folder', season: 6 }, true)).toBe(
      '瑞克和莫蒂 (Rick and Morty) (2013) - Season 06',
    )
    expect(
      renderEpisodeFileName(
        rickAndMorty,
        { episodes: [1], season: 6 },
        'S06E01.Solaricks.1080p.mp4',
      ),
    ).toBe('瑞克和莫蒂 (Rick and Morty) - S06E01.mp4')
  })

  it('renders movie names without turning numbered sequels into TV episodes', () => {
    expect(
      renderMovieFileName(
        {
          titleOriginal: '2 Fast 2 Furious',
          titleZh: '速度与激情2',
          year: 2003,
        },
        'Fast.and.Furious.S01E02.2160p.mp4',
        'en-zh',
      ),
    ).toBe('2 Fast 2 Furious (速度与激情2) (2003).mp4')

    expect(
      normalizeAiClassification({
        items: [
          {
            id: 'movie-1',
            role: 'movie',
            titleOriginal: 'The Fast and the Furious',
            titleZh: '速度与激情',
            year: 2001,
          },
        ],
        mediaType: 'movie-collection',
        series: null,
      }),
    ).toMatchObject({ mediaType: 'movie-collection', series: { titleZh: '' } })
  })

  it('keeps Emby-compatible labels for multiple movie versions', () => {
    expect(
      extractMovieVersionLabel('The.Furious.2026.2160p.iT.WEB-DL.DDP5.1.Atmos.H.265-OGGY.mkv'),
    ).toBe('2160p WEB-DL H.265 Atmos OGGY')
    expect(
      extractMovieVersionLabel(
        'The.Furious.2026.2160p.MA.WEBDL.DDP5.1.Atmos.DV.HDR.H.265-Draken02.mkv',
      ),
    ).toBe('2160p DV HDR WEB-DL H.265 Atmos Draken02')
    expect(
      renderMovieFileName(
        {
          titleOriginal: 'The Furious',
          titleZh: '狂怒',
          versionLabel: '2160p DV HDR WEB-DL',
          year: 2026,
        },
        'The.Furious.2026.mkv',
        'zh-en',
      ),
    ).toBe('狂怒 (The Furious) (2026) - 2160p DV HDR WEB-DL.mkv')
  })

  it('supports Chinese-first, English-first and single-language naming rules', () => {
    expect(formatSeriesTitle({ ...rickAndMorty, namingStyle: 'zh-en' })).toBe(
      '瑞克和莫蒂 (Rick and Morty) (2013)',
    )
    expect(formatSeriesTitle({ ...rickAndMorty, namingStyle: 'en-zh' })).toBe(
      'Rick and Morty (瑞克和莫蒂) (2013)',
    )
    expect(formatSeriesTitle({ ...rickAndMorty, namingStyle: 'zh' })).toBe('瑞克和莫蒂 (2013)')
    expect(formatSeriesTitle({ ...rickAndMorty, namingStyle: 'en' })).toBe('Rick and Morty (2013)')
  })

  it('keeps version, multipart and original extension', () => {
    expect(formatEpisodeToken({ episodes: [5, 6], part: 'part1', season: 1, version: 'v2' })).toBe(
      'S01E05-E06v2-part1',
    )
    expect(
      renderEpisodeFileName(
        { titleOriginal: 'Another Era', titleZh: '创世纪', year: 2018 },
        { episode: 1, season: 1 },
        '01.MKV',
      ),
    ).toBe('创世纪 (Another Era) - S01E01.MKV')
  })

  it('renames matched sidecars and leaves unmatched roles empty', () => {
    const mediaNames = new Map([['video-1', '瑞克和莫蒂 (Rick and Morty) - S06E01.mkv']])

    expect(
      renderSidecarFileName(
        rickAndMorty,
        { language: 'zh-CN', role: 'sidecar', sidecarFor: 'video-1' },
        'old.zh.srt',
        mediaNames,
      ),
    ).toBe('瑞克和莫蒂 (Rick and Morty) - S06E01.zh-CN.srt')
    expect(renderSidecarFileName(rickAndMorty, { role: 'ignore' }, 'advert.png')).toBe('')
  })

  it('matches and renames subtitles deterministically without AI metadata', () => {
    const mediaEntries = [
      { id: 'episode-1', name: 'Rick.and.Morty.S06E01.1080p.mkv' },
      { id: 'episode-2', name: 'Rick.and.Morty.S06E02.1080p.mkv' },
    ]
    const subtitle = { name: 'Rick.and.Morty.S06E01.1080p.zh-CN.forced.srt' }

    expect(isSubtitleFileName(subtitle.name)).toBe(true)
    expect(matchSubtitleToMedia(subtitle, mediaEntries)).toBe(mediaEntries[0])
    expect(getSubtitleQualifier(subtitle.name, mediaEntries[0].name)).toBe('.zh-CN.forced')
    expect(
      renderSubtitleFileName(
        '瑞克和莫蒂 (Rick and Morty) - S06E01.mkv',
        subtitle.name,
        mediaEntries[0].name,
      ),
    ).toBe('瑞克和莫蒂 (Rick and Morty) - S06E01.zh-CN.forced.srt')
  })

  it('uses a single video as the safe fallback while preserving known subtitle qualifiers', () => {
    const media = { id: 'movie', name: 'Whiplash (爆裂鼓手) (2014).mkv' }
    const subtitle = { name: 'Whiplash (2014 IMDB 8.6 1080p BluRay).zh-HK.srt' }

    expect(matchSubtitleToMedia(subtitle, [media])).toBe(media)
    expect(
      renderSubtitleFileName(media.name, subtitle.name, 'Whiplash (2014 IMDB 8.6 1080p).mkv'),
    ).toBe('Whiplash (爆裂鼓手) (2014).zh-HK.srt')
  })

  it('sanitizes unsafe title characters and validates basenames', () => {
    expect(sanitizeNameSegment('A/B\\C:*?')).toBe('A B C')
    expect(isValidRenameBasename('Season 01')).toBe(true)
    expect(isValidRenameBasename('../Season 01')).toBe(false)
    expect(isValidRenameBasename('bad/name')).toBe(false)
  })

  it('parses fenced JSON and rejects classifications without a title', () => {
    expect(parseAiJsonContent('```json\n{"ok":true}\n```')).toEqual({ ok: true })
    expect(() => normalizeAiClassification({ items: [], series: {} })).toThrow('AI 未识别出剧名')
    expect(() => normalizeAiClassification({ items: [], series: null })).toThrow('AI 未识别出剧名')
    expect(() =>
      normalizeAiClassification({ items: [], mediaType: 'movie-collection', series: null }),
    ).toThrow('AI 未识别出电影名')
  })
})
