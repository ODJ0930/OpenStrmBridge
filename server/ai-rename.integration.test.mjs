import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server.address().port))
  })
}

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

async function reservePort() {
  const server = createServer()
  const port = await listen(server)
  await close(server)
  return port
}

async function waitForBackend(baseUrl, child, output) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < 15_000) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early (${child.exitCode}):\n${output.join('')}`)
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`)

      if (response.ok) {
        return
      }
    } catch {
      // Wait for the child process to bind the port.
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Backend did not start:\n${output.join('')}`)
}

function normalizeVirtualPath(value) {
  const normalized = path.posix.normalize(`/${String(value ?? '').replace(/^\/+/, '')}`)
  return normalized === '/.' ? '/' : normalized
}

function listVirtualChildren(tree, directoryPath) {
  const directory = normalizeVirtualPath(directoryPath)
  return [...tree.entries()]
    .filter(([candidate]) => candidate !== directory && path.posix.dirname(candidate) === directory)
    .map(([candidate, entry]) => ({
      ...entry,
      name: path.posix.basename(candidate),
      path: candidate,
    }))
}

function moveVirtualTree(tree, sourcePath, targetPath) {
  const source = normalizeVirtualPath(sourcePath)
  const target = normalizeVirtualPath(targetPath)

  if (!tree.has(source) || tree.has(target)) {
    return false
  }

  const affected = [...tree.entries()].filter(
    ([candidate]) => candidate === source || candidate.startsWith(`${source}/`),
  )

  for (const [candidate] of affected) {
    tree.delete(candidate)
  }

  for (const [candidate, entry] of affected) {
    const relative = path.posix.relative(source, candidate)
    tree.set(relative ? path.posix.join(target, relative) : target, entry)
  }

  return true
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

describe('AI rename local-storage integration', () => {
  let aiServer
  let aiBaseUrl
  let openListServer
  let openListBaseUrl
  let webDavServer
  let webDavBaseUrl
  let backendBaseUrl
  let backendProcess
  let tempDirectory
  let libraryDirectory
  let managedLibraryDirectory
  let managedNestedLibraryDirectory
  let movieLibraryDirectory
  let moveLibraryDirectory
  let nestedLibraryDirectory
  let preStrmLibraryDirectory
  let strmOutputDirectory
  const openListTree = new Map()
  const webDavTree = new Map()
  const backendOutput = []
  const aiRequestPayloads = []
  const inventoryRequestGroupCounts = []
  const inventoryRequests = []

  beforeAll(async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openstrmbridge-ai-rename-'))
    libraryDirectory = path.join(tempDirectory, 'library')
    const sourceDirectory = path.join(
      libraryDirectory,
      '【高清剧集网发布】瑞克和莫蒂.第六季.Rick.and.Morty.S01.1080p',
    )
    await mkdir(sourceDirectory, { recursive: true })
    await writeFile(path.join(sourceDirectory, 'S06E01.Solaricks.1080p.HD中英双字.mp4'), 'media')
    await writeFile(path.join(sourceDirectory, '更多电视剧下载请访问官网.png'), 'advert')
    movieLibraryDirectory = path.join(tempDirectory, 'movie-library')
    const movieCollectionDirectory = path.join(movieLibraryDirectory, 'Fast & Furious Collection')
    await mkdir(movieCollectionDirectory, { recursive: true })
    await writeFile(path.join(movieCollectionDirectory, 'Fast & Furious - S01E01.mp4'), 'movie-1')
    await writeFile(path.join(movieCollectionDirectory, 'Fast & Furious - S01E02.mp4'), 'movie-2')
    moveLibraryDirectory = path.join(tempDirectory, 'move-library')
    const seasonOneDirectory = path.join(moveLibraryDirectory, 'Rick.and.Morty.S01.1080p')
    const seasonTwoDirectory = path.join(moveLibraryDirectory, 'Rick.and.Morty.S02.1080p')
    await mkdir(seasonOneDirectory, { recursive: true })
    await mkdir(seasonTwoDirectory, { recursive: true })
    await writeFile(path.join(seasonOneDirectory, 'Rick.and.Morty.S01E01.mkv'), 'season-1')
    await writeFile(path.join(seasonTwoDirectory, 'Rick.and.Morty.S02E01.mkv'), 'season-2')
    nestedLibraryDirectory = path.join(tempDirectory, 'nested-library')
    const nestedSeasonDirectory = path.join(
      nestedLibraryDirectory,
      '电视剧',
      '黑镜',
      'Black.Mirror.S03',
    )
    await mkdir(nestedSeasonDirectory, { recursive: true })
    await writeFile(
      path.join(nestedSeasonDirectory, 'Black.Mirror.S03E01.1080p.mkv'),
      'black-mirror-season-3',
    )
    await mkdir(path.join(nestedLibraryDirectory, '电视剧', '空目录'), { recursive: true })
    managedNestedLibraryDirectory = path.join(tempDirectory, 'managed-nested-library')
    const managedNestedSeasonDirectory = path.join(
      managedNestedLibraryDirectory,
      '电视剧',
      '黑镜',
      'Black.Mirror.S03',
    )
    await mkdir(managedNestedSeasonDirectory, { recursive: true })
    await writeFile(
      path.join(managedNestedSeasonDirectory, 'Black.Mirror.S03E01.1080p.mkv'),
      'managed-black-mirror-season-3',
    )
    await mkdir(path.join(managedNestedLibraryDirectory, '电视剧', '空目录'), {
      recursive: true,
    })
    managedLibraryDirectory = path.join(tempDirectory, 'managed-library')
    const managedSeasonDirectory = path.join(managedLibraryDirectory, 'Rick.and.Morty.S05.1080p')
    const managedUnknownDirectory = path.join(managedLibraryDirectory, 'Unknown.Show')
    await mkdir(managedSeasonDirectory, { recursive: true })
    await mkdir(managedUnknownDirectory, { recursive: true })
    await writeFile(
      path.join(managedSeasonDirectory, 'Rick.and.Morty.S05E01.mkv'),
      'managed-season',
    )
    await writeFile(path.join(managedUnknownDirectory, 'Unknown.Video.mkv'), 'unknown')
    preStrmLibraryDirectory = path.join(tempDirectory, 'pre-strm-library')
    const preStrmSeasonDirectory = path.join(preStrmLibraryDirectory, 'Rick.and.Morty.S07.1080p')
    await mkdir(preStrmSeasonDirectory, { recursive: true })
    await writeFile(path.join(preStrmSeasonDirectory, 'Rick.and.Morty.S07E01.mkv'), 'pre-strm')
    strmOutputDirectory = path.join(tempDirectory, 'strm-output')

    aiServer = createServer(async (request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            data: [
              { id: 'integration-model', owned_by: 'integration' },
              { id: 'integration-model-fast', owned_by: 'integration' },
            ],
          }),
        )
        return
      }

      let body = ''

      for await (const chunk of request) {
        body += chunk
      }

      const payload = JSON.parse(body)
      aiRequestPayloads.push(payload)
      const prompt = String(payload.messages?.at(-1)?.content ?? '')

      if (prompt.includes('"service":"ai-rename"')) {
        const content = JSON.stringify({
          ok: true,
          probe: 'speed-test-0123456789',
          service: 'ai-rename',
        })
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            choices: [{ message: { content, role: 'assistant' } }],
            usage: { completion_tokens: 18 },
          }),
        )
        return
      }

      const marker = '待识别媒体目录清单：'
      const inventory = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length))
      inventoryRequestGroupCounts.push(inventory.length)
      inventoryRequests.push(inventory)
      const groups = inventory.map((group) => {
        const entries = group.entries

        if (/Unknown\.Show/i.test(group.directoryName)) {
          return {
            groupId: group.groupId,
            items: entries.map((entry) => ({ id: entry.id, role: 'ignore' })),
            mediaType: 'tv',
            series: null,
          }
        }

        if (/Black\.Mirror/i.test(JSON.stringify(entries))) {
          const seasonMatch = JSON.stringify(entries).match(/S(\d{1,2})(?:E|[\s._-]|")/i)
          const season = seasonMatch ? Number.parseInt(seasonMatch[1], 10) : 3
          const items = entries.map((entry) => {
            if (entry.kind === 'folder') {
              return { id: entry.id, role: 'season-folder', season }
            }

            if (/\.(?:mp4|mkv)$/i.test(entry.name)) {
              return { episodes: [1], id: entry.id, role: 'episode', season }
            }

            return { id: entry.id, role: 'ignore' }
          })

          return {
            groupId: group.groupId,
            items,
            mediaType: 'tv',
            series: {
              season,
              titleOriginal: 'Black Mirror',
              titleZh: '黑镜',
              year: 2011,
            },
          }
        }

        if (/Fast\s*&\s*Furious/i.test(group.directoryName)) {
          const movies = [
            {
              titleOriginal: 'The Fast and the Furious',
              titleZh: '速度与激情',
              year: 2001,
            },
            {
              titleOriginal: '2 Fast 2 Furious',
              titleZh: '速度与激情2',
              year: 2003,
            },
          ]
          const items = entries.map((entry) => {
            if (entry.kind === 'folder') {
              return { id: entry.id, role: 'collection-folder' }
            }

            if (/\.(?:mp4|mkv)$/i.test(entry.name)) {
              const episode = Number.parseInt(entry.name.match(/E(\d{1,2})/i)?.[1] ?? '', 10)
              return {
                id: entry.id,
                role: 'movie',
                ...(movies[episode - 1] ?? movies[0]),
              }
            }

            return { id: entry.id, role: 'ignore' }
          })

          return {
            groupId: group.groupId,
            items,
            mediaType: 'movie-collection',
            series: null,
          }
        }

        const seasonMatch = JSON.stringify(entries).match(/S(\d{1,2})E/i)
        const season = seasonMatch ? Number.parseInt(seasonMatch[1], 10) : 6
        const items = entries.map((entry) => {
          const entrySeasonMatch = entry.name.match(/S(\d{1,2})(?:E|[\s._-]|$)/i)
          const entrySeason = entrySeasonMatch ? Number.parseInt(entrySeasonMatch[1], 10) : season

          if (entry.kind === 'folder') {
            return { id: entry.id, role: 'season-folder', season: entrySeason }
          }

          if (/\.(?:mp4|mkv)$/i.test(entry.name)) {
            return { episodes: [1], id: entry.id, role: 'episode', season: entrySeason }
          }

          return { id: entry.id, role: 'ignore' }
        })

        return {
          groupId: group.groupId,
          items,
          series: {
            season,
            titleOriginal: 'Rick and Morty',
            titleZh: '瑞克和莫蒂',
            year: 2013,
          },
        }
      })
      const content = JSON.stringify({ groups })

      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content, role: 'assistant' } }] }))
    })
    const aiPort = await listen(aiServer)
    aiBaseUrl = `http://127.0.0.1:${aiPort}/v1`

    openListTree.set('/tv', { kind: 'folder' })
    openListTree.set('/tv/黑镜', { kind: 'folder' })
    openListTree.set('/tv/黑镜/Black.Mirror.S03', { kind: 'folder' })
    openListTree.set('/tv/黑镜/Black.Mirror.S03/Black.Mirror.S03E01.mkv', {
      kind: 'file',
    })
    openListServer = createServer(async (request, response) => {
      let body = ''

      for await (const chunk of request) {
        body += chunk
      }

      const payload = body ? JSON.parse(body) : {}
      const send = (code, data, message = 'success') => {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ code, data, message }))
      }

      if (request.url === '/api/fs/list') {
        const content = listVirtualChildren(openListTree, payload.path).map((entry) => ({
          is_dir: entry.kind === 'folder',
          modified: '2026-01-01T00:00:00Z',
          name: entry.name,
          size: entry.kind === 'file' ? 1024 : 0,
        }))
        send(200, { content, total: content.length })
        return
      }

      if (request.url === '/api/fs/get') {
        const entry = openListTree.get(normalizeVirtualPath(payload.path))
        send(entry ? 200 : 500, entry ?? null, entry ? 'success' : 'object not found')
        return
      }

      if (request.url === '/api/fs/rename') {
        const source = normalizeVirtualPath(payload.path)
        const target = path.posix.join(path.posix.dirname(source), payload.name)
        send(moveVirtualTree(openListTree, source, target) ? 200 : 500, null, 'rename')
        return
      }

      if (request.url === '/api/fs/mkdir') {
        const target = normalizeVirtualPath(payload.path)

        if (!openListTree.has(target)) {
          openListTree.set(target, { kind: 'folder' })
        }
        send(200, null)
        return
      }

      if (request.url === '/api/fs/move') {
        let ok = true

        for (const name of payload.names ?? []) {
          ok =
            moveVirtualTree(
              openListTree,
              path.posix.join(payload.src_dir, name),
              path.posix.join(payload.dst_dir, name),
            ) && ok
        }
        send(ok ? 200 : 500, null, 'move')
        return
      }

      send(404, null, 'not found')
    })
    const openListPort = await listen(openListServer)
    openListBaseUrl = `http://127.0.0.1:${openListPort}`

    webDavTree.set('/tv', { kind: 'folder' })
    webDavTree.set('/tv/黑镜', { kind: 'folder' })
    webDavTree.set('/tv/黑镜/Black.Mirror.S04', { kind: 'folder' })
    webDavTree.set('/tv/黑镜/Black.Mirror.S04/Black.Mirror.S04E01.mkv', {
      kind: 'file',
    })
    webDavServer = createServer(async (request, response) => {
      const url = new URL(request.url, 'http://localhost')
      const remotePath = normalizeVirtualPath(
        decodeURIComponent(url.pathname).replace(/^\/dav(?=\/|$)/, ''),
      )

      if (request.method === 'PROPFIND') {
        const current = webDavTree.get(remotePath)

        if (!current) {
          response.writeHead(404)
          response.end()
          return
        }

        const depth = String(request.headers.depth ?? '1')
        const entries = [
          { ...current, name: path.posix.basename(remotePath), path: remotePath },
          ...(depth === '0' ? [] : listVirtualChildren(webDavTree, remotePath)),
        ]
        const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries
          .map(
            (entry) =>
              `<d:response><d:href>${escapeXml(`/dav${entry.path}${entry.kind === 'folder' ? '/' : ''}`)}</d:href><d:propstat><d:prop><d:displayname>${escapeXml(entry.name)}</d:displayname><d:resourcetype>${entry.kind === 'folder' ? '<d:collection/>' : ''}</d:resourcetype><d:getcontentlength>${entry.kind === 'file' ? '1024' : '0'}</d:getcontentlength><d:getlastmodified>Wed, 01 Jan 2026 00:00:00 GMT</d:getlastmodified></d:prop></d:propstat></d:response>`,
          )
          .join('')}</d:multistatus>`
        response.writeHead(207, { 'Content-Type': 'application/xml' })
        response.end(xml)
        return
      }

      if (request.method === 'HEAD') {
        response.writeHead(webDavTree.has(remotePath) ? 200 : 404)
        response.end()
        return
      }

      if (request.method === 'MKCOL') {
        if (!webDavTree.has(remotePath)) {
          webDavTree.set(remotePath, { kind: 'folder' })
        }
        response.writeHead(201)
        response.end()
        return
      }

      if (request.method === 'MOVE') {
        const destination = new URL(String(request.headers.destination))
        const targetPath = normalizeVirtualPath(
          decodeURIComponent(destination.pathname).replace(/^\/dav(?=\/|$)/, ''),
        )
        response.writeHead(moveVirtualTree(webDavTree, remotePath, targetPath) ? 201 : 412)
        response.end()
        return
      }

      response.writeHead(405)
      response.end()
    })
    const webDavPort = await listen(webDavServer)
    webDavBaseUrl = `http://127.0.0.1:${webDavPort}/dav`

    const dataDirectory = path.join(tempDirectory, 'data')
    await mkdir(dataDirectory, { recursive: true })
    await writeFile(
      path.join(dataDirectory, 'storages.json'),
      JSON.stringify([
        {
          accessMethod: 'local',
          endpoint: libraryDirectory,
          id: 'local-test',
          local: { path: libraryDirectory },
          name: '本地测试',
          rootPath: libraryDirectory,
          status: 'connected',
        },
        {
          accessMethod: 'local',
          endpoint: moveLibraryDirectory,
          id: 'local-move-test',
          local: { path: moveLibraryDirectory },
          name: '本地移动测试',
          rootPath: moveLibraryDirectory,
          status: 'connected',
        },
        {
          accessMethod: 'local',
          endpoint: nestedLibraryDirectory,
          id: 'local-nested-test',
          local: { path: nestedLibraryDirectory },
          name: '本地深层目录测试',
          rootPath: nestedLibraryDirectory,
          status: 'connected',
        },
        {
          accessMethod: 'local',
          endpoint: movieLibraryDirectory,
          id: 'local-movie-test',
          local: { path: movieLibraryDirectory },
          name: '本地电影合集测试',
          rootPath: movieLibraryDirectory,
          status: 'connected',
        },
        {
          accessMethod: 'local',
          endpoint: managedLibraryDirectory,
          id: 'local-managed-test',
          local: { path: managedLibraryDirectory },
          name: '本地任务管理测试',
          rootPath: managedLibraryDirectory,
          status: 'connected',
        },
        {
          accessMethod: 'local',
          endpoint: managedNestedLibraryDirectory,
          id: 'local-managed-nested-test',
          local: { path: managedNestedLibraryDirectory },
          name: '本地托管深层目录测试',
          rootPath: managedNestedLibraryDirectory,
          status: 'connected',
        },
        {
          accessMethod: 'local',
          endpoint: preStrmLibraryDirectory,
          id: 'local-pre-strm-test',
          local: { path: preStrmLibraryDirectory },
          name: '本地生成前重命名测试',
          rootPath: preStrmLibraryDirectory,
          status: 'connected',
        },
        {
          accessMethod: 'openlist',
          endpoint: openListBaseUrl,
          id: 'openlist-test',
          name: 'OpenList 测试',
          openlist: { basePath: '/tv', enableUrlEncoding: true, token: 'token' },
          rootPath: '/tv',
          status: 'connected',
        },
        {
          accessMethod: 'webdav',
          endpoint: webDavBaseUrl,
          id: 'webdav-test',
          name: 'WebDAV 测试',
          rootPath: '/tv',
          status: 'connected',
          webdav: { password: 'pass', username: 'user' },
        },
      ]),
    )
    await writeFile(
      path.join(dataDirectory, 'settings.json'),
      JSON.stringify({
        aiRename: {
          apiKey: 'integration-secret',
          baseUrl: aiBaseUrl,
          model: 'integration-model',
          tmdbEnabled: false,
        },
        strm: {
          mediaExtensions: 'mp4,mkv',
          minMediaSizeMb: 0,
          outputRoot: strmOutputDirectory,
          sidecarExtensions: 'nfo,jpg,png,srt',
        },
      }),
    )
    const historicalJobTime = '2026-07-17T02:27:17.000Z'
    await writeFile(
      path.join(dataDirectory, 'ai-rename-tasks.json'),
      JSON.stringify([
        {
          allowMove: false,
          createdAt: historicalJobTime,
          id: 'historical-skipped-task',
          lastJob: {
            allowMove: false,
            createdAt: historicalJobTime,
            currentPath: '',
            finishedAt: historicalJobTime,
            id: 'historical-skipped-job',
            message: '处理完成：成功 0，跳过 6，失败 0',
            path: libraryDirectory,
            progress: {
              analyzed: 131,
              completedOperations: 131,
              failed: 0,
              ignored: 125,
              scanned: 131,
              skipped: 6,
              succeeded: 0,
              totalOperations: 131,
            },
            results: [],
            stage: 'finished',
            status: 'failed',
            storageId: 'local-test',
            useTmdb: false,
          },
          lastRunAt: historicalJobTime,
          name: '历史跳过结果',
          path: libraryDirectory,
          status: 'failed',
          storageId: 'local-test',
          updatedAt: historicalJobTime,
          useTmdb: false,
        },
      ]),
    )

    const backendPort = await reservePort()
    backendBaseUrl = `http://127.0.0.1:${backendPort}`
    backendProcess = spawn(process.execPath, ['server/storage-check-server.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENSTRMBRIDGE_BACKEND_HOST: '127.0.0.1',
        OPENSTRMBRIDGE_BACKEND_PORT: String(backendPort),
        OPENSTRMBRIDGE_DATA_DIR: dataDirectory,
        OPENSTRMBRIDGE_WEB_DIR: path.join(tempDirectory, 'web'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    backendProcess.stdout.on('data', (chunk) => backendOutput.push(String(chunk)))
    backendProcess.stderr.on('data', (chunk) => backendOutput.push(String(chunk)))
    await waitForBackend(backendBaseUrl, backendProcess, backendOutput)
  }, 25_000)

  afterAll(async () => {
    backendProcess?.kill()
    await close(aiServer)
    await close(openListServer)
    await close(webDavServer)
    await rm(tempDirectory, { force: true, recursive: true })
  })

  it('normalizes historical skipped-only results to completed instead of failed', async () => {
    const headers = {
      Origin: backendBaseUrl,
      Referer: `${backendBaseUrl}/ai-rename-tasks`,
    }
    const tasks = await (await fetch(`${backendBaseUrl}/api/ai-rename/tasks`, { headers })).json()
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'historical-skipped-task',
          lastJob: expect.objectContaining({ status: 'completed' }),
          status: 'completed',
        }),
      ]),
    )

    const result = await (
      await fetch(`${backendBaseUrl}/api/ai-rename/tasks/historical-skipped-task/result`, {
        headers,
      })
    ).json()
    expect(result).toMatchObject({
      progress: { failed: 0, skipped: 6, succeeded: 0 },
      stage: 'finished',
      status: 'completed',
    })
  })

  it('keeps credentials server-side and renames media recursively without touching adverts', async () => {
    const headers = {
      'Content-Type': 'application/json',
      Origin: backendBaseUrl,
      Referer: `${backendBaseUrl}/browser`,
    }
    const settingsResponse = await fetch(`${backendBaseUrl}/api/settings`, { headers })
    const settings = await settingsResponse.json()

    expect(settings.aiRename).toMatchObject({
      apiKeyConfigured: true,
      baseUrl: aiBaseUrl,
      customParameters: '{}',
      model: 'integration-model',
      namingStyle: 'zh-en',
      promptTemplate: expect.any(String),
      rebuildFolders: false,
      tmdbTokenConfigured: false,
    })
    expect(settings.aiRename).not.toHaveProperty('apiKey')

    const updatedPrompt = '集成测试提示词：优先识别正式剧名，无法确认时跳过。'
    const customParameters = JSON.stringify({
      model_reasoning_effort: 'xhigh',
      service_tier: 'priority',
      temperature: 0.25,
    })
    const savePromptResponse = await fetch(`${backendBaseUrl}/api/settings/ai-rename`, {
      body: JSON.stringify({ customParameters, promptTemplate: updatedPrompt }),
      headers,
      method: 'PUT',
    })
    expect(savePromptResponse.status).toBe(200)
    expect(await savePromptResponse.json()).toMatchObject({
      customParameters: expect.stringContaining('model_reasoning_effort'),
      promptTemplate: updatedPrompt,
    })

    const reloadedSettings = await (
      await fetch(`${backendBaseUrl}/api/settings`, { headers })
    ).json()
    expect(reloadedSettings.aiRename.promptTemplate).toBe(updatedPrompt)
    expect(JSON.parse(reloadedSettings.aiRename.customParameters)).toEqual({
      model_reasoning_effort: 'xhigh',
      service_tier: 'priority',
      temperature: 0.25,
    })
    expect(reloadedSettings.aiRename.apiKeyConfigured).toBe(true)
    expect(reloadedSettings.aiRename).not.toHaveProperty('apiKey')

    const modelsResponse = await fetch(`${backendBaseUrl}/api/ai-rename/models`, {
      body: JSON.stringify({ baseUrl: aiBaseUrl }),
      headers,
      method: 'POST',
    })
    expect(modelsResponse.status).toBe(200)
    const modelsResult = await modelsResponse.json()
    expect(modelsResult).toMatchObject({
      count: 2,
      models: [
        { id: 'integration-model', ownedBy: 'integration' },
        { id: 'integration-model-fast', ownedBy: 'integration' },
      ],
      ok: true,
    })

    const testResponse = await fetch(`${backendBaseUrl}/api/ai-rename/test`, {
      body: JSON.stringify({ baseUrl: aiBaseUrl, model: 'integration-model' }),
      headers,
      method: 'POST',
    })
    expect(testResponse.status).toBe(200)
    const testResult = await testResponse.json()
    expect(testResult).toMatchObject({
      completionTokens: 18,
      model: 'integration-model',
      ok: true,
      tokenCountEstimated: false,
    })
    expect(testResult.latencyMs).toBeGreaterThan(0)
    expect(testResult.tokensPerSecond).toBeGreaterThan(0)
    const probeRequest = aiRequestPayloads.find((payload) =>
      String(payload.messages?.at(-1)?.content ?? '').includes('"service":"ai-rename"'),
    )
    expect(probeRequest).toMatchObject({
      model: 'integration-model',
      model_reasoning_effort: 'xhigh',
      service_tier: 'priority',
      stream: false,
      temperature: 0.25,
    })
    expect(probeRequest.messages).toBeInstanceOf(Array)
    expect(probeRequest.response_format).toEqual({ type: 'json_object' })

    const protectedParameterResponse = await fetch(`${backendBaseUrl}/api/settings/ai-rename`, {
      body: JSON.stringify({ customParameters: '{"model":"forbidden"}' }),
      headers,
      method: 'PUT',
    })
    expect(protectedParameterResponse.status).toBe(400)
    expect(await protectedParameterResponse.json()).toMatchObject({
      message: expect.stringContaining('不能覆盖受保护字段：model'),
    })

    const createResponse = await fetch(`${backendBaseUrl}/api/storage/ai-rename/jobs`, {
      body: JSON.stringify({
        allowMove: false,
        path: libraryDirectory,
        recursive: true,
        storageId: 'local-test',
        useTmdb: false,
      }),
      headers,
      method: 'POST',
    })
    expect(createResponse.status).toBe(202)
    let job = await createResponse.json()

    for (
      let attempt = 0;
      attempt < 100 && !['completed', 'partial', 'failed'].includes(job.status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      const response = await fetch(
        `${backendBaseUrl}/api/storage/ai-rename/jobs/${encodeURIComponent(job.id)}`,
        { headers },
      )
      job = await response.json()
    }

    expect(job.status, JSON.stringify(job, null, 2)).toBe('completed')
    expect(job.progress).toMatchObject({ failed: 0, skipped: 0, succeeded: 2 })

    const renamedDirectory = path.join(
      libraryDirectory,
      '瑞克和莫蒂 (Rick and Morty) (2013) - Season 06',
    )
    const names = await readdir(renamedDirectory)
    expect(names).toContain('瑞克和莫蒂 (Rick and Morty) - S06E01.mp4')
    expect(names).toContain('更多电视剧下载请访问官网.png')
    expect(
      await readFile(path.join(renamedDirectory, '更多电视剧下载请访问官网.png'), 'utf8'),
    ).toBe('advert')
  }, 20_000)

  it('renames a numbered movie collection as individual movies instead of TV episodes', async () => {
    const headers = {
      'Content-Type': 'application/json',
      Origin: backendBaseUrl,
      Referer: `${backendBaseUrl}/ai-rename-tasks`,
    }
    const createResponse = await fetch(`${backendBaseUrl}/api/storage/ai-rename/jobs`, {
      body: JSON.stringify({
        allowMove: true,
        path: movieLibraryDirectory,
        recursive: true,
        storageId: 'local-movie-test',
        useTmdb: false,
      }),
      headers,
      method: 'POST',
    })
    expect(createResponse.status).toBe(202)
    let job = await createResponse.json()

    for (
      let attempt = 0;
      attempt < 100 && !['completed', 'partial', 'failed'].includes(job.status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      job = await (
        await fetch(`${backendBaseUrl}/api/storage/ai-rename/jobs/${encodeURIComponent(job.id)}`, {
          headers,
        })
      ).json()
    }

    expect(job.status, JSON.stringify(job, null, 2)).toBe('completed')
    expect(job.progress).toMatchObject({ failed: 0, skipped: 0, succeeded: 2 })
    const collectionDirectory = path.join(movieLibraryDirectory, 'Fast & Furious Collection')
    const names = await readdir(collectionDirectory)
    expect(names).toEqual(
      expect.arrayContaining([
        '速度与激情 (The Fast and the Furious) (2001).mp4',
        '速度与激情2 (2 Fast 2 Furious) (2003).mp4',
      ]),
    )
    expect(names).not.toContain('Season 01')
    expect(names.some((name) => /S01E\d+/i.test(name))).toBe(false)
  }, 20_000)

  it('creates and merges standard season directories when moving is enabled', async () => {
    const aiRequestCountBefore = aiRequestPayloads.length
    const inventoryRequestCountBefore = inventoryRequestGroupCounts.length
    const headers = {
      'Content-Type': 'application/json',
      Origin: backendBaseUrl,
      Referer: `${backendBaseUrl}/browser`,
    }
    const createResponse = await fetch(`${backendBaseUrl}/api/storage/ai-rename/jobs`, {
      body: JSON.stringify({
        allowMove: true,
        path: moveLibraryDirectory,
        recursive: true,
        storageId: 'local-move-test',
        useTmdb: false,
      }),
      headers,
      method: 'POST',
    })
    expect(createResponse.status).toBe(202)
    let job = await createResponse.json()

    for (
      let attempt = 0;
      attempt < 100 && !['completed', 'partial', 'failed'].includes(job.status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      const response = await fetch(
        `${backendBaseUrl}/api/storage/ai-rename/jobs/${encodeURIComponent(job.id)}`,
        { headers },
      )
      job = await response.json()
    }

    expect(job.status, JSON.stringify(job, null, 2)).toBe('completed')
    const showDirectory = path.join(moveLibraryDirectory, '瑞克和莫蒂 (Rick and Morty) (2013)')
    expect(await readdir(showDirectory)).toEqual(['Season 01', 'Season 02'])
    expect(await readdir(path.join(showDirectory, 'Season 01'))).toContain(
      '瑞克和莫蒂 (Rick and Morty) - S01E01.mkv',
    )
    expect(await readdir(path.join(showDirectory, 'Season 02'))).toContain(
      '瑞克和莫蒂 (Rick and Morty) - S02E01.mkv',
    )
    expect(inventoryRequestGroupCounts.slice(inventoryRequestCountBefore)).toEqual([1])
    const taskAiRequests = aiRequestPayloads.slice(aiRequestCountBefore)
    expect(taskAiRequests).toHaveLength(1)
    expect(String(taskAiRequests[0].messages?.at(-1)?.content)).toContain('Emby 标准名称')
    expect(job.progress).toMatchObject({ processedGroups: 1, totalGroups: 1 })
    expect(job.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'directory',
          message: expect.stringContaining('开始执行 AI 建议（1/1），逻辑组根：'),
          status: 'info',
        }),
        expect.objectContaining({
          action: 'inventory',
          message: 'AI 已一次性返回 1/1 个逻辑媒体组的修改建议，开始按顺序执行',
          status: 'info',
        }),
        expect.objectContaining({
          action: 'directory',
          message: expect.stringContaining('逻辑媒体组处理完成（1/1）'),
          status: 'info',
        }),
      ]),
    )
  }, 20_000)

  it('discovers a deep series container and preserves its category hierarchy', async () => {
    const inventoryRequestCountBefore = inventoryRequests.length
    const headers = {
      'Content-Type': 'application/json',
      Origin: backendBaseUrl,
      Referer: `${backendBaseUrl}/ai-rename-tasks`,
    }
    const createResponse = await fetch(`${backendBaseUrl}/api/storage/ai-rename/jobs`, {
      body: JSON.stringify({
        allowMove: true,
        path: nestedLibraryDirectory,
        recursive: true,
        storageId: 'local-nested-test',
        useTmdb: false,
      }),
      headers,
      method: 'POST',
    })
    expect(createResponse.status).toBe(202)
    let job = await createResponse.json()

    for (
      let attempt = 0;
      attempt < 100 && !['completed', 'partial', 'failed'].includes(job.status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      job = await (
        await fetch(`${backendBaseUrl}/api/storage/ai-rename/jobs/${encodeURIComponent(job.id)}`, {
          headers,
        })
      ).json()
    }

    expect(job.status, JSON.stringify(job, null, 2)).toBe('completed')
    expect(job.progress).toMatchObject({ processedGroups: 1, totalGroups: 1 })
    const canonicalSeriesDirectory = path.join(
      nestedLibraryDirectory,
      '电视剧',
      '黑镜 (Black Mirror) (2011)',
    )
    expect(await readdir(nestedLibraryDirectory)).toEqual(['电视剧'])
    expect(await readdir(canonicalSeriesDirectory)).toEqual(['Season 03'])
    expect(await readdir(path.join(canonicalSeriesDirectory, 'Season 03'))).toEqual([
      '黑镜 (Black Mirror) - S03E01.mkv',
    ])
    const submittedInventory = inventoryRequests[inventoryRequestCountBefore]
    expect(submittedInventory).toHaveLength(1)
    expect(submittedInventory[0]).toMatchObject({
      directoryName: '黑镜',
      directoryPath: '电视剧/黑镜',
      layoutHint: 'series-container',
      mediaHint: 'tv',
    })
    expect(submittedInventory[0].entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ depth: 1, inferredRole: 'series-folder', name: '黑镜' }),
        expect.objectContaining({
          depth: 2,
          inferredRole: 'season-folder',
          inferredSeason: 3,
          name: 'Black.Mirror.S03',
        }),
      ]),
    )
    expect(job.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'directory',
          oldPath: path.join(nestedLibraryDirectory, '电视剧', '黑镜'),
        }),
      ]),
    )
  }, 20_000)

  it('uses deep logical media groups for managed AI rename tasks and their incremental baseline', async () => {
    const headers = {
      'Content-Type': 'application/json',
      Origin: backendBaseUrl,
      Referer: `${backendBaseUrl}/ai-rename-tasks`,
    }
    const taskId = 'managed-deep-media-task'
    const runManagedTask = async () => {
      const runResponse = await fetch(
        `${backendBaseUrl}/api/ai-rename/tasks/${encodeURIComponent(taskId)}/run`,
        { headers, method: 'POST' },
      )
      expect(runResponse.status).toBe(202)
      let job = (await runResponse.json()).job

      for (
        let attempt = 0;
        attempt < 100 && !['completed', 'partial', 'failed'].includes(job.status);
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        job = await (
          await fetch(
            `${backendBaseUrl}/api/ai-rename/tasks/${encodeURIComponent(taskId)}/result`,
            { headers },
          )
        ).json()
      }

      return job
    }
    const saveResponse = await fetch(
      `${backendBaseUrl}/api/ai-rename/tasks/${encodeURIComponent(taskId)}`,
      {
        body: JSON.stringify({
          allowMove: true,
          extraPrompt: '',
          name: '托管任务整理黑镜第三季',
          path: managedNestedLibraryDirectory,
          storageId: 'local-managed-nested-test',
          useTmdb: false,
        }),
        headers,
        method: 'PUT',
      },
    )
    expect(saveResponse.status).toBe(200)
    const inventoryRequestCountBefore = inventoryRequests.length
    let job = await runManagedTask()

    expect(job.status, JSON.stringify(job, null, 2)).toBe('completed')
    expect(job.taskId).toBe(taskId)
    expect(job.incrementalInventory).toMatchObject({
      baselineUpdated: true,
      inventoryGroups: 1,
      submittedGroups: 1,
      unchangedGroups: 0,
    })
    const canonicalSeriesDirectory = path.join(
      managedNestedLibraryDirectory,
      '电视剧',
      '黑镜 (Black Mirror) (2011)',
    )
    const canonicalMediaFile = path.join(
      canonicalSeriesDirectory,
      'Season 03',
      '黑镜 (Black Mirror) - S03E01.mkv',
    )
    expect(await readdir(managedNestedLibraryDirectory)).toEqual(['电视剧'])
    expect(await readFile(canonicalMediaFile, 'utf8')).toBe('managed-black-mirror-season-3')
    const submittedInventory = inventoryRequests[inventoryRequestCountBefore]
    expect(submittedInventory).toHaveLength(1)
    expect(submittedInventory[0]).toMatchObject({
      directoryName: '黑镜',
      directoryPath: '电视剧/黑镜',
      layoutHint: 'series-container',
      mediaHint: 'tv',
    })
    expect(job.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'directory',
          message: expect.stringContaining('逻辑组根：'),
          oldPath: path.join(managedNestedLibraryDirectory, '电视剧', '黑镜'),
        }),
      ]),
    )

    const aiRequestCountAfterInitialRun = aiRequestPayloads.length
    job = await runManagedTask()
    expect(job.status, JSON.stringify(job, null, 2)).toBe('completed')
    expect(job.incrementalInventory).toMatchObject({
      baselineUpdated: true,
      inventoryGroups: 1,
      submittedGroups: 0,
      unchangedGroups: 1,
    })
    expect(aiRequestPayloads).toHaveLength(aiRequestCountAfterInitialRun)
    expect(job.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('本次未调用 AI') }),
      ]),
    )

    await writeFile(canonicalMediaFile, 'managed-black-mirror-season-3-updated-content')
    job = await runManagedTask()
    expect(job.status, JSON.stringify(job, null, 2)).toBe('completed')
    expect(job.incrementalInventory).toMatchObject({
      baselineUpdated: true,
      inventoryGroups: 1,
      submittedGroups: 1,
      unchangedGroups: 0,
    })
    expect(aiRequestPayloads).toHaveLength(aiRequestCountAfterInitialRun + 1)
    expect(inventoryRequests.at(-1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          directoryPath: '电视剧/黑镜 (Black Mirror) (2011)',
          layoutHint: 'series-container',
        }),
      ]),
    )

    const deleteResponse = await fetch(
      `${backendBaseUrl}/api/ai-rename/tasks/${encodeURIComponent(taskId)}`,
      { headers, method: 'DELETE' },
    )
    expect(deleteResponse.status).toBe(200)
  }, 20_000)

  it('persists, runs, reports and deletes a managed AI rename task', async () => {
    const headers = {
      'Content-Type': 'application/json',
      Origin: backendBaseUrl,
      Referer: `${backendBaseUrl}/ai-rename-tasks`,
    }
    const taskId = 'managed-integration-task'
    const saveResponse = await fetch(
      `${backendBaseUrl}/api/ai-rename/tasks/${encodeURIComponent(taskId)}`,
      {
        body: JSON.stringify({
          allowMove: false,
          extraPrompt: '这是任务管理集成测试。',
          name: '整理第五季',
          path: managedLibraryDirectory,
          storageId: 'local-managed-test',
          useTmdb: false,
        }),
        headers,
        method: 'PUT',
      },
    )
    expect(saveResponse.status).toBe(200)
    expect(await saveResponse.json()).toMatchObject({ id: taskId, status: 'idle' })

    const listResponse = await fetch(`${backendBaseUrl}/api/ai-rename/tasks`, { headers })
    expect(await listResponse.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: taskId, name: '整理第五季' })]),
    )

    const runResponse = await fetch(
      `${backendBaseUrl}/api/ai-rename/tasks/${encodeURIComponent(taskId)}/run`,
      { headers, method: 'POST' },
    )
    expect(runResponse.status).toBe(202)
    let job = (await runResponse.json()).job

    for (
      let attempt = 0;
      attempt < 100 && !['completed', 'partial', 'failed'].includes(job.status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      job = await (
        await fetch(`${backendBaseUrl}/api/ai-rename/tasks/${encodeURIComponent(taskId)}/result`, {
          headers,
        })
      ).json()
    }

    expect(job.status, JSON.stringify(job, null, 2)).toBe('completed')
    expect(job.taskId).toBe(taskId)
    expect(job.incrementalInventory).toMatchObject({
      baselineUpdated: true,
      inventoryGroups: 2,
      submittedGroups: 2,
      unchangedGroups: 0,
    })
    const renamedManagedDirectory = path.join(
      managedLibraryDirectory,
      '瑞克和莫蒂 (Rick and Morty) (2013) - Season 05',
    )
    const renamedManagedFile = path.join(
      renamedManagedDirectory,
      '瑞克和莫蒂 (Rick and Morty) - S05E01.mkv',
    )
    expect(await readdir(renamedManagedDirectory)).toContain(path.basename(renamedManagedFile))

    const aiRequestCountAfterInitialRun = aiRequestPayloads.length
    const unchangedRunResponse = await fetch(
      `${backendBaseUrl}/api/ai-rename/tasks/${encodeURIComponent(taskId)}/run`,
      { headers, method: 'POST' },
    )
    expect(unchangedRunResponse.status).toBe(202)
    job = (await unchangedRunResponse.json()).job

    for (
      let attempt = 0;
      attempt < 100 && !['completed', 'partial', 'failed'].includes(job.status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      job = await (
        await fetch(`${backendBaseUrl}/api/ai-rename/tasks/${encodeURIComponent(taskId)}/result`, {
          headers,
        })
      ).json()
    }

    expect(job.status, JSON.stringify(job, null, 2)).toBe('completed')
    expect(job.incrementalInventory).toMatchObject({
      baselineUpdated: true,
      inventoryGroups: 2,
      submittedGroups: 0,
      unchangedGroups: 2,
    })
    expect(aiRequestPayloads).toHaveLength(aiRequestCountAfterInitialRun)
    expect(job.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('本次未调用 AI') }),
      ]),
    )

    await writeFile(renamedManagedFile, 'managed-season-content-updated')
    const changedRunResponse = await fetch(
      `${backendBaseUrl}/api/ai-rename/tasks/${encodeURIComponent(taskId)}/run`,
      { headers, method: 'POST' },
    )
    expect(changedRunResponse.status).toBe(202)
    job = (await changedRunResponse.json()).job

    for (
      let attempt = 0;
      attempt < 100 && !['completed', 'partial', 'failed'].includes(job.status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      job = await (
        await fetch(`${backendBaseUrl}/api/ai-rename/tasks/${encodeURIComponent(taskId)}/result`, {
          headers,
        })
      ).json()
    }

    expect(job.status, JSON.stringify(job, null, 2)).toBe('completed')
    expect(job.incrementalInventory).toMatchObject({
      baselineUpdated: true,
      inventoryGroups: 2,
      submittedGroups: 1,
      unchangedGroups: 1,
    })
    expect(aiRequestPayloads).toHaveLength(aiRequestCountAfterInitialRun + 1)

    const deleteResponse = await fetch(
      `${backendBaseUrl}/api/ai-rename/tasks/${encodeURIComponent(taskId)}`,
      { headers, method: 'DELETE' },
    )
    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.json()).toMatchObject({ deleted: true, ok: true })
  }, 20_000)

  it('runs AI rename before scanning and generating STRM when enabled on a task', async () => {
    const headers = {
      'Content-Type': 'application/json',
      Origin: backendBaseUrl,
      Referer: `${backendBaseUrl}/tasks`,
    }
    const taskId = 'pre-strm-ai-rename-task'
    const taskName = '生成前整理测试'
    const saveResponse = await fetch(`${backendBaseUrl}/api/tasks/${encodeURIComponent(taskId)}`, {
      body: JSON.stringify({
        aiRenameBeforeStrm: true,
        directoryTimeCheck: true,
        incremental: true,
        name: taskName,
        path: preStrmLibraryDirectory,
        preRefreshOpenListCache: false,
        schedule: '0 0 * * *',
        storageId: 'local-pre-strm-test',
      }),
      headers,
      method: 'PUT',
    })
    expect(saveResponse.status).toBe(200)
    expect(await saveResponse.json()).toMatchObject({ aiRenameBeforeStrm: true, id: taskId })

    const runResponse = await fetch(
      `${backendBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/run`,
      { headers, method: 'POST' },
    )
    expect(runResponse.status).toBe(200)
    const runResult = await runResponse.json()
    expect(runResult.result).toMatchObject({
      aiRenameFailed: 0,
      aiRenameInventoryGroups: 1,
      aiRenameStatus: 'completed',
      aiRenameSubmittedGroups: 1,
      aiRenameSucceeded: 2,
      aiRenameUnchangedGroups: 0,
      generated: 1,
      ok: true,
    })

    const renamedDirectoryName = '瑞克和莫蒂 (Rick and Morty) (2013) - Season 07'
    const renamedMediaName = '瑞克和莫蒂 (Rick and Morty) - S07E01.mkv'
    const renamedMediaPath = path.join(
      preStrmLibraryDirectory,
      renamedDirectoryName,
      renamedMediaName,
    )
    const generatedStrmPath = path.join(
      strmOutputDirectory,
      taskName,
      renamedDirectoryName,
      '瑞克和莫蒂 (Rick and Morty) - S07E01.strm',
    )
    expect(await readFile(renamedMediaPath, 'utf8')).toBe('pre-strm')
    expect((await readFile(generatedStrmPath, 'utf8')).trim()).toBe(renamedMediaPath)
    expect(runResult.task.lastLog.indexOf('>>> 开始生成 STRM 前的 AI 重命名')).toBeLessThan(
      runResult.task.lastLog.indexOf('>>> 开始扫描并生成'),
    )
    expect(runResult.task.lastLog).toContain('AI 重命名预处理完成：状态 completed')
    expect(runResult.task.lastLog).toContain('提交 LLM 1 个，未变化跳过 0 个')

    const aiRequestCountAfterInitialRun = aiRequestPayloads.length
    const unchangedRunResponse = await fetch(
      `${backendBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/run`,
      { headers, method: 'POST' },
    )
    expect(unchangedRunResponse.status).toBe(200)
    const unchangedRunResult = await unchangedRunResponse.json()
    expect(unchangedRunResult.result).toMatchObject({
      aiRenameInventoryGroups: 1,
      aiRenameStatus: 'completed',
      aiRenameSubmittedGroups: 0,
      aiRenameUnchangedGroups: 1,
      generated: 0,
      skipped: 1,
    })
    expect(aiRequestPayloads).toHaveLength(aiRequestCountAfterInitialRun)
    expect(unchangedRunResult.task.lastLog).toContain('本次未调用 AI')

    const newSeasonDirectory = path.join(preStrmLibraryDirectory, 'Rick.and.Morty.S08.1080p')
    await mkdir(newSeasonDirectory, { recursive: true })
    await writeFile(path.join(newSeasonDirectory, 'Rick.and.Morty.S08E01.mkv'), 'pre-strm-new')
    const incrementalInventoryCountBefore = inventoryRequestGroupCounts.length
    const changedRunResponse = await fetch(
      `${backendBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/run`,
      { headers, method: 'POST' },
    )
    expect(changedRunResponse.status).toBe(200)
    const changedRunResult = await changedRunResponse.json()
    expect(changedRunResult.result).toMatchObject({
      aiRenameInventoryGroups: 1,
      aiRenameStatus: 'completed',
      aiRenameSubmittedGroups: 1,
      aiRenameUnchangedGroups: 0,
      generated: 1,
      skipped: 1,
    })
    expect(aiRequestPayloads).toHaveLength(aiRequestCountAfterInitialRun + 1)
    expect(inventoryRequestGroupCounts.slice(incrementalInventoryCountBefore)).toEqual([1])
  }, 20_000)

  it('renames OpenList entries through the filesystem API without overwriting', async () => {
    const headers = {
      'Content-Type': 'application/json',
      Origin: backendBaseUrl,
      Referer: `${backendBaseUrl}/browser`,
    }
    const createResponse = await fetch(`${backendBaseUrl}/api/storage/ai-rename/jobs`, {
      body: JSON.stringify({
        allowMove: false,
        path: '/tv',
        recursive: true,
        storageId: 'openlist-test',
        useTmdb: false,
      }),
      headers,
      method: 'POST',
    })
    let job = await createResponse.json()

    for (
      let attempt = 0;
      attempt < 100 && !['completed', 'partial', 'failed'].includes(job.status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      job = await (
        await fetch(`${backendBaseUrl}/api/storage/ai-rename/jobs/${encodeURIComponent(job.id)}`, {
          headers,
        })
      ).json()
    }

    expect(job.status, JSON.stringify(job, null, 2)).toBe('completed')
    expect(openListTree.has('/tv/黑镜 (Black Mirror) (2011)/Season 03')).toBe(true)
    expect(
      openListTree.has('/tv/黑镜 (Black Mirror) (2011)/Season 03/黑镜 (Black Mirror) - S03E01.mkv'),
    ).toBe(true)
  }, 20_000)

  it('renames WebDAV entries with MOVE and Overwrite disabled', async () => {
    const headers = {
      'Content-Type': 'application/json',
      Origin: backendBaseUrl,
      Referer: `${backendBaseUrl}/browser`,
    }
    const createResponse = await fetch(`${backendBaseUrl}/api/storage/ai-rename/jobs`, {
      body: JSON.stringify({
        allowMove: false,
        path: '/tv',
        recursive: true,
        storageId: 'webdav-test',
        useTmdb: false,
      }),
      headers,
      method: 'POST',
    })
    let job = await createResponse.json()

    for (
      let attempt = 0;
      attempt < 100 && !['completed', 'partial', 'failed'].includes(job.status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      job = await (
        await fetch(`${backendBaseUrl}/api/storage/ai-rename/jobs/${encodeURIComponent(job.id)}`, {
          headers,
        })
      ).json()
    }

    expect(job.status, JSON.stringify(job, null, 2)).toBe('completed')
    expect(webDavTree.has('/tv/黑镜 (Black Mirror) (2011)/Season 04')).toBe(true)
    expect(
      webDavTree.has('/tv/黑镜 (Black Mirror) (2011)/Season 04/黑镜 (Black Mirror) - S04E01.mkv'),
    ).toBe(true)
  }, 20_000)
})
