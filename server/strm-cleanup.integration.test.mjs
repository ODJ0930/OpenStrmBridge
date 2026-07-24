import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { access, mkdtemp, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function reservePort() {
  const server = createServer()
  const port = await listen(server)
  await new Promise((resolve) => server.close(resolve))
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
      // Wait until the child starts listening.
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Backend did not start:\n${output.join('')}`)
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

describe('STRM stale-file cleanup integration', () => {
  let backendBaseUrl
  let backendProcess
  let currentMediaFile
  let dataDirectory
  let libraryDirectory
  let outputDirectory
  let outputRoot
  let seasonDirectory
  let sourceSubtitleFile
  let tempDirectory
  const backendOutput = []
  const headers = { 'Content-Type': 'application/json' }
  const taskId = 'cleanup-task'

  async function runTask() {
    const response = await fetch(`${backendBaseUrl}/api/tasks/${taskId}/run`, {
      headers: {
        ...headers,
        Origin: backendBaseUrl,
        Referer: `${backendBaseUrl}/tasks`,
      },
      method: 'POST',
    })
    const payload = await response.json()

    expect(response.status, JSON.stringify(payload, null, 2)).toBe(200)
    return payload
  }

  beforeAll(async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openstrmbridge-strm-cleanup-'))
    dataDirectory = path.join(tempDirectory, 'data')
    libraryDirectory = path.join(tempDirectory, 'library')
    outputRoot = path.join(tempDirectory, 'output')
    outputDirectory = path.join(outputRoot, 'Cleanup Task')
    seasonDirectory = path.join(libraryDirectory, 'Old Show', 'Season 01')
    currentMediaFile = path.join(seasonDirectory, 'Old Name S01E01.mkv')
    sourceSubtitleFile = path.join(seasonDirectory, 'Old Name S01E01.zh-CN.srt')
    await mkdir(dataDirectory, { recursive: true })
    await mkdir(seasonDirectory, { recursive: true })
    await writeFile(currentMediaFile, 'media')
    await writeFile(sourceSubtitleFile, 'subtitle')
    await writeFile(
      path.join(dataDirectory, 'settings.json'),
      JSON.stringify({
        strm: {
          mediaExtensions: 'mkv,mp4',
          minMediaSizeMb: 0,
          outputRoot,
          threadCount: 1,
        },
      }),
    )
    await writeFile(
      path.join(dataDirectory, 'storages.json'),
      JSON.stringify([
        {
          accessMethod: 'local',
          endpoint: libraryDirectory,
          id: 'cleanup-local-storage',
          local: { path: libraryDirectory },
          name: 'Cleanup Local',
          rootPath: libraryDirectory,
        },
      ]),
    )
    await writeFile(
      path.join(dataDirectory, 'tasks.json'),
      JSON.stringify([
        {
          directoryTimeCheck: false,
          id: taskId,
          incremental: true,
          name: 'Cleanup Task',
          path: libraryDirectory,
          preRefreshOpenListCache: false,
          schedule: '0 0 * * *',
          status: 'idle',
          storageId: 'cleanup-local-storage',
        },
      ]),
    )

    const backendPort = await reservePort()
    backendBaseUrl = `http://127.0.0.1:${backendPort}`
    backendProcess = spawn(process.execPath, ['server/storage-check-server.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENSTRMBRIDGE_BACKEND_PORT: String(backendPort),
        OPENSTRMBRIDGE_DATA_DIR: dataDirectory,
        OPENSTRMBRIDGE_SCAN_MEDIA_FILE_LIMIT: '2',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    backendProcess.stdout.on('data', (chunk) => backendOutput.push(String(chunk)))
    backendProcess.stderr.on('data', (chunk) => backendOutput.push(String(chunk)))
    await waitForBackend(backendBaseUrl, backendProcess, backendOutput)
  }, 20_000)

  afterAll(async () => {
    if (backendProcess && backendProcess.exitCode === null) {
      backendProcess.kill()
      await new Promise((resolve) => backendProcess.once('exit', resolve))
    }

    if (tempDirectory) {
      await rm(tempDirectory, { force: true, recursive: true })
    }
  })

  it('removes an indexed STRM after its cloud file and directories are renamed', async () => {
    const firstRun = await runTask()
    expect(firstRun.result).toMatchObject({ cleanupDeleted: 0, ok: true })

    const oldStrmFile = path.join(outputDirectory, 'Old Show', 'Season 01', 'Old Name S01E01.strm')
    const oldSubtitleFile = path.join(
      outputDirectory,
      'Old Show',
      'Season 01',
      'Old Name S01E01.zh-CN.srt',
    )
    expect(await exists(oldStrmFile)).toBe(true)
    expect(await readFile(oldSubtitleFile, 'utf8')).toBe('subtitle')

    const renamedShowDirectory = path.join(libraryDirectory, 'Renamed Show')
    await rename(path.join(libraryDirectory, 'Old Show'), renamedShowDirectory)
    seasonDirectory = path.join(renamedShowDirectory, 'Season 01')
    currentMediaFile = path.join(seasonDirectory, 'New Name S01E01.mkv')
    sourceSubtitleFile = path.join(seasonDirectory, 'Old Name S01E01.zh-CN.srt')
    await rename(path.join(seasonDirectory, 'Old Name S01E01.mkv'), currentMediaFile)

    const secondRun = await runTask()
    const newStrmFile = path.join(
      outputDirectory,
      'Renamed Show',
      'Season 01',
      'New Name S01E01.strm',
    )
    const newSubtitleFile = path.join(
      outputDirectory,
      'Renamed Show',
      'Season 01',
      'New Name S01E01.zh-CN.srt',
    )

    expect(secondRun.result).toMatchObject({
      cleanupDeleted: 1,
      cleanupFailed: 0,
      cleanupSkipped: false,
      ok: true,
      subtitleCleanupDeleted: 1,
      subtitlesGenerated: 1,
    })
    expect(await exists(newStrmFile)).toBe(true)
    expect(await readFile(newSubtitleFile, 'utf8')).toBe('subtitle')
    expect(await exists(oldStrmFile)).toBe(false)
    expect(await exists(oldSubtitleFile)).toBe(false)
    expect(await exists(path.join(outputDirectory, 'Old Show'))).toBe(false)

    const indexEntries = JSON.parse(
      await readFile(path.join(dataDirectory, 'strm-index.json'), 'utf8'),
    ).filter((entry) => entry.taskId === taskId)
    expect(indexEntries).toHaveLength(1)
    expect(indexEntries[0].sourcePath).toBe(currentMediaFile)
    expect(indexEntries[0].subtitleFiles).toEqual([newSubtitleFile])
  }, 20_000)

  it('keeps old STRM files when the scan reaches its safety limit', async () => {
    const previousStrmFile = path.join(
      outputDirectory,
      'Renamed Show',
      'Season 01',
      'New Name S01E01.strm',
    )
    const nextMediaFile = path.join(seasonDirectory, 'Another Name S01E01.mkv')
    await rename(currentMediaFile, nextMediaFile)
    currentMediaFile = nextMediaFile
    await writeFile(path.join(seasonDirectory, 'Second S01E02.mkv'), 'second-media')

    const run = await runTask()

    expect(run.result).toMatchObject({
      cleanupDeleted: 0,
      cleanupSkipped: true,
      scanLimitReached: true,
      status: 'partial',
    })
    expect(await exists(previousStrmFile)).toBe(true)
    expect(run.task.lastLog).toContain('跳过旧 STRM 清理：达到扫描上限')
  }, 20_000)

  it('detaches stale index paths outside the output without deleting external files', async () => {
    await unlink(path.join(seasonDirectory, 'Second S01E02.mkv'))
    const externalStrmFile = path.join(tempDirectory, 'must-not-delete.strm')
    await writeFile(externalStrmFile, 'external')
    const indexFile = path.join(dataDirectory, 'strm-index.json')
    const indexEntries = JSON.parse(await readFile(indexFile, 'utf8'))
    indexEntries.push({
      sourcePath: '/missing/outside.mkv',
      strmFile: externalStrmFile,
      taskId,
      taskName: 'Cleanup Task',
    })
    await writeFile(indexFile, JSON.stringify(indexEntries, null, 2))

    const run = await runTask()

    expect(run.result).toMatchObject({
      cleanupDetached: 1,
      cleanupFailed: 0,
      cleanupSkipped: false,
      status: 'succeeded',
    })
    expect(await exists(externalStrmFile)).toBe(true)
    expect(run.task.lastLog).toContain('已移除历史或越界 STRM 索引（未删除磁盘文件）')
    const reloadedIndex = JSON.parse(await readFile(indexFile, 'utf8'))
    expect(reloadedIndex.some((entry) => entry.strmFile === externalStrmFile)).toBe(false)
  }, 20_000)

  it('treats unchanged incremental STRM files as a successful run', async () => {
    const run = await runTask()

    expect(run.result).toMatchObject({
      failed: 0,
      failedDirectories: 0,
      generated: 0,
      ok: true,
      partial: false,
      skipped: 1,
      status: 'succeeded',
    })
    expect(run.task.status).toBe('succeeded')
    expect(run.task.lastLog).toContain('生成 0 个，跳过 1 个，失败 0 个')
  }, 20_000)
})
