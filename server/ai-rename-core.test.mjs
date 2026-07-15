import { describe, expect, it } from 'vitest'

import {
  formatEpisodeToken,
  formatSeriesTitle,
  isValidRenameBasename,
  normalizeAiClassification,
  parseAiJsonContent,
  renderEpisodeFileName,
  renderFolderName,
  renderSidecarFileName,
  sanitizeNameSegment,
} from './ai-rename-core.mjs'

const rickAndMorty = {
  season: 6,
  titleOriginal: 'Rick and Morty',
  titleZh: '瑞克和莫蒂',
  year: 2013,
}

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

  it('sanitizes unsafe title characters and validates basenames', () => {
    expect(sanitizeNameSegment('A/B\\C:*?')).toBe('A B C')
    expect(isValidRenameBasename('Season 01')).toBe(true)
    expect(isValidRenameBasename('../Season 01')).toBe(false)
    expect(isValidRenameBasename('bad/name')).toBe(false)
  })

  it('parses fenced JSON and rejects classifications without a title', () => {
    expect(parseAiJsonContent('```json\n{"ok":true}\n```')).toEqual({ ok: true })
    expect(() => normalizeAiClassification({ items: [], series: {} })).toThrow('AI 未识别出剧名')
  })
})
