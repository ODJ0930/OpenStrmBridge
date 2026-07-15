import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { get as httpsGet } from 'node:https'
import { platform } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'))
const nodeVersion = process.version
const releaseRoot = path.join(rootDir, 'release')
const cacheRoot = path.join(rootDir, '.release-cache')

const targets = {
  'win-x64': {
    artifactName: `openstrmbridge-v${packageJson.version}-windows-x64.zip`,
    goArch: 'amd64',
    goOs: 'windows',
    ge2oName: 'ge2o.exe',
    nodeArchive: 'zip',
    nodeName: `node-${nodeVersion}-win-x64`,
    startCommand: 'start.cmd',
  },
  'linux-x64': {
    artifactName: `openstrmbridge-v${packageJson.version}-debian-x64.tar.gz`,
    goArch: 'amd64',
    goOs: 'linux',
    ge2oName: 'ge2o',
    nodeArchive: 'tar.gz',
    nodeName: `node-${nodeVersion}-linux-x64`,
    startCommand: 'start.sh',
  },
  'linux-arm64': {
    artifactName: `openstrmbridge-v${packageJson.version}-debian-arm64.tar.gz`,
    goArch: 'arm64',
    goOs: 'linux',
    ge2oName: 'ge2o',
    nodeArchive: 'tar.gz',
    nodeName: `node-${nodeVersion}-linux-arm64`,
    startCommand: 'start.sh',
  },
  'macos-x64': {
    artifactName: `openstrmbridge-v${packageJson.version}-macos-x64.tar.gz`,
    goArch: 'amd64',
    goOs: 'darwin',
    ge2oName: 'ge2o',
    nodeArchive: 'tar.gz',
    nodeName: `node-${nodeVersion}-darwin-x64`,
    startCommand: 'start.sh',
  },
  'macos-arm64': {
    artifactName: `openstrmbridge-v${packageJson.version}-macos-arm64.tar.gz`,
    goArch: 'arm64',
    goOs: 'darwin',
    ge2oName: 'ge2o',
    nodeArchive: 'tar.gz',
    nodeName: `node-${nodeVersion}-darwin-arm64`,
    startCommand: 'start.sh',
  },
}

function getCurrentTargetName() {
  const currentPlatform = platform()

  if (currentPlatform === 'win32') {
    return 'win-x64'
  }

  if (currentPlatform === 'darwin') {
    return process.arch === 'arm64' ? 'macos-arm64' : 'macos-x64'
  }

  if (currentPlatform === 'linux') {
    return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  }

  throw new Error(`不支持的当前平台：${currentPlatform}/${process.arch}`)
}

function getRequestedTargets() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--current')) {
    return [getCurrentTargetName()]
  }

  if (args.includes('--all')) {
    return Object.keys(targets)
  }

  for (const target of args) {
    if (!targets[target]) {
      throw new Error(`未知目标平台：${target}。可选值：${Object.keys(targets).join(', ')}`)
    }
  }

  return args
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { env, ...spawnOptions } = options
    const useShell = process.platform === 'win32' && ['npm', 'pnpm'].includes(command)
    const executable = useShell ? command : command
    const child = spawn(executable, args, {
      ...(useShell ? { shell: true } : {}),
      cwd: rootDir,
      env: {
        ...process.env,
        ...env,
      },
      stdio: 'inherit',
      ...spawnOptions,
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
      }
    })
  })
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

function downloadWithHttps(url, outputFile, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, (response) => {
      const statusCode = response.statusCode ?? 0

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume()

        if (redirectCount > 5) {
          reject(new Error(`下载重定向次数过多：${url}`))
          return
        }

        resolve(
          downloadWithHttps(
            new URL(response.headers.location, url).toString(),
            outputFile,
            redirectCount + 1,
          ),
        )
        return
      }

      if (statusCode !== 200) {
        response.resume()
        reject(new Error(`下载 Node 运行时失败：HTTP ${statusCode}`))
        return
      }

      pipeline(response, createWriteStream(outputFile)).then(resolve, reject)
    })

    request.setTimeout(120_000, () => {
      request.destroy(new Error(`下载超时：${url}`))
    })
    request.once('error', reject)
  })
}

async function downloadFile(url, outputFile) {
  if (await pathExists(outputFile)) {
    const { size } = await stat(outputFile)

    if (size > 0) {
      return
    }

    await rm(outputFile, { force: true })
  }

  await mkdir(path.dirname(outputFile), { recursive: true })
  console.log(`Downloading ${url}`)

  const tempFile = `${outputFile}.tmp`

  await rm(tempFile, { force: true })

  try {
    await downloadWithHttps(url, tempFile)

    const { size } = await stat(tempFile)

    if (size === 0) {
      throw new Error(`下载文件为空：${url}`)
    }

    await rename(tempFile, outputFile)
  } catch (error) {
    await rm(tempFile, { force: true })
    throw error
  }
}

async function ensureNodeRuntime(target) {
  const nodeDir = path.join(cacheRoot, 'node', target.nodeName)

  if (await pathExists(nodeDir)) {
    return nodeDir
  }

  const archiveName = `${target.nodeName}.${target.nodeArchive}`
  const archiveUrl = `https://nodejs.org/dist/${nodeVersion}/${archiveName}`
  const archiveFile = path.join(cacheRoot, 'downloads', archiveName)

  await downloadFile(archiveUrl, archiveFile)
  await mkdir(path.dirname(nodeDir), { recursive: true })

  const extractArgs = ['-xf', archiveFile, '-C', path.dirname(nodeDir)]

  if (target.goOs !== 'windows') {
    extractArgs.push(
      `--exclude=${target.nodeName}/bin/corepack`,
      `--exclude=${target.nodeName}/bin/npm`,
      `--exclude=${target.nodeName}/bin/npx`,
    )
  }

  await run('tar', extractArgs)

  return nodeDir
}

async function buildFrontend() {
  await run('pnpm', ['build'])
}

async function buildGe2oWeb() {
  const sourceDir = path.join(rootDir, 'vendor', 'go-emby2openlist', 'web', 'src')
  const outputDir = path.join(rootDir, 'vendor', 'go-emby2openlist', 'web', 'dist')

  await run('npm', ['ci'], { cwd: sourceDir })
  await run('npm', ['run', 'build'], { cwd: sourceDir })
  await rm(outputDir, { force: true, recursive: true })
  await cp(path.join(sourceDir, 'build', 'client'), outputDir, { recursive: true })
}

async function buildGe2o(target, outputFile) {
  await mkdir(path.dirname(outputFile), { recursive: true })
  await run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', outputFile, '.'], {
    cwd: path.join(rootDir, 'vendor', 'go-emby2openlist'),
    env: {
      CGO_ENABLED: '0',
      GOARCH: target.goArch,
      GOOS: target.goOs,
    },
  })

  if (target.goOs !== 'windows') {
    await chmod(outputFile, 0o755)
  }
}

async function writeLaunchers(releaseDir, target) {
  const isWindows = target.goOs === 'windows'

  if (isWindows) {
    await writeFile(
      path.join(releaseDir, 'start.cmd'),
      `@echo off\r\nsetlocal\r\nset "APP_DIR=%~dp0"\r\nset "OPENSTRMBRIDGE_DATA_DIR=%APP_DIR%data"\r\nset "OPENSTRMBRIDGE_WEB_DIR=%APP_DIR%dist"\r\nset "OPENSTRMBRIDGE_GE2O_BINARY=%APP_DIR%resources\\bin\\ge2o.exe"\r\nif not defined OPENSTRMBRIDGE_BACKEND_HOST set "OPENSTRMBRIDGE_BACKEND_HOST=0.0.0.0"\r\nif not defined OPENSTRMBRIDGE_BACKEND_PUBLIC_URL set "OPENSTRMBRIDGE_BACKEND_PUBLIC_URL=http://host.docker.internal:5174"\r\n"%APP_DIR%runtime\\node\\node.exe" "%APP_DIR%server\\storage-check-server.mjs"\r\n`,
      'utf8',
    )
    return
  }

  const launcher = path.join(releaseDir, 'start.sh')

  await writeFile(
    launcher,
    `#!/usr/bin/env sh\nset -eu\nAPP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nPUBLIC_HOST="\${OPENSTRMBRIDGE_PUBLIC_HOST:-}"\nif [ -z "$PUBLIC_HOST" ]; then\n  case "$(uname -s)" in\n    Darwin) PUBLIC_HOST="host.docker.internal" ;;\n    *) PUBLIC_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')" ;;\n  esac\nfi\nif [ -z "$PUBLIC_HOST" ]; then\n  PUBLIC_HOST="127.0.0.1"\nfi\nexport OPENSTRMBRIDGE_DATA_DIR="$APP_DIR/data"\nexport OPENSTRMBRIDGE_WEB_DIR="$APP_DIR/dist"\nexport OPENSTRMBRIDGE_GE2O_BINARY="$APP_DIR/resources/bin/ge2o"\nexport OPENSTRMBRIDGE_BACKEND_HOST="\${OPENSTRMBRIDGE_BACKEND_HOST:-0.0.0.0}"\nexport OPENSTRMBRIDGE_BACKEND_PUBLIC_URL="\${OPENSTRMBRIDGE_BACKEND_PUBLIC_URL:-http://\${PUBLIC_HOST}:5174}"\nexec "$APP_DIR/runtime/node/bin/node" "$APP_DIR/server/storage-check-server.mjs"\n`,
    'utf8',
  )
  await chmod(launcher, 0o755)
}

async function writePortableReadme(releaseDir, targetName) {
  const content = [
    `# OpenStrmBridge Portable (${targetName})`,
    '',
    `Version: ${packageJson.version}`,
    '',
    '双击或执行启动脚本即可运行，不需要安装 Node.js、pnpm、npm 依赖或 Go。',
    '',
    '- Windows: 双击 `start.cmd`',
    '- Linux / macOS: 执行 `./start.sh`',
    '',
    '启动后访问：',
    '',
    '```text',
    'http://127.0.0.1:5174',
    '```',
    '',
    '默认账号密码：',
    '',
    '```text',
    'admin / openstrmbridge',
    '```',
    '',
    '运行数据保存在当前目录的 `data/`，请不要把里面的 token、密码或配置提交到公开仓库。',
    '',
  ].join('\n')

  await writeFile(path.join(releaseDir, 'README-PORTABLE.md'), content, 'utf8')
}

async function packageTarget(targetName) {
  const target = targets[targetName]
  const releaseDir = path.join(releaseRoot, `openstrmbridge-${targetName}`)
  const nodeRuntimeDir = await ensureNodeRuntime(target)

  console.log(`Packaging ${targetName}`)
  await rm(releaseDir, { force: true, recursive: true })
  await mkdir(releaseDir, { recursive: true })
  await mkdir(path.join(releaseDir, 'runtime'), { recursive: true })
  await mkdir(path.join(releaseDir, 'resources', 'bin'), { recursive: true })
  await mkdir(path.join(releaseDir, 'data'), { recursive: true })

  await cp(nodeRuntimeDir, path.join(releaseDir, 'runtime', 'node'), { recursive: true })
  await cp(path.join(rootDir, 'dist'), path.join(releaseDir, 'dist'), { recursive: true })
  await cp(path.join(rootDir, 'server'), path.join(releaseDir, 'server'), { recursive: true })
  await cp(path.join(rootDir, 'resources'), path.join(releaseDir, 'resources'), { recursive: true })
  await copyFile(path.join(rootDir, 'README.md'), path.join(releaseDir, 'README.md'))
  await copyFile(path.join(rootDir, 'LICENSE'), path.join(releaseDir, 'LICENSE'))

  await buildGe2o(target, path.join(releaseDir, 'resources', 'bin', target.ge2oName))
  await writeLaunchers(releaseDir, target)
  await writePortableReadme(releaseDir, targetName)
}

function quotePowerShellPath(filePath) {
  return `'${filePath.replaceAll("'", "''")}'`
}

async function archiveTarget(targetName) {
  const target = targets[targetName]
  const releaseDirName = `openstrmbridge-${targetName}`
  const artifactDir = path.join(releaseRoot, 'artifacts')
  const artifactFile = path.join(artifactDir, target.artifactName)

  await mkdir(artifactDir, { recursive: true })
  await rm(artifactFile, { force: true })

  if (target.artifactName.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const sourcePattern = path.join(releaseRoot, releaseDirName, '*')

      await run('powershell', [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path ${quotePowerShellPath(sourcePattern)} -DestinationPath ${quotePowerShellPath(artifactFile)} -Force`,
      ])
    } else {
      await run('zip', ['-qr', artifactFile, releaseDirName], { cwd: releaseRoot })
    }

    return
  }

  await run('tar', ['-czf', artifactFile, '-C', releaseRoot, releaseDirName])
}

async function copyManagerScript() {
  const artifactDir = path.join(releaseRoot, 'artifacts')

  await mkdir(artifactDir, { recursive: true })
  await copyFile(
    path.join(rootDir, 'scripts', 'openstrmbridge-manager.sh'),
    path.join(artifactDir, 'openstrmbridge-manager.sh'),
  )
}

const requestedTargets = getRequestedTargets()

await buildFrontend()
await buildGe2oWeb()
await mkdir(releaseRoot, { recursive: true })

for (const targetName of requestedTargets) {
  await packageTarget(targetName)
  await archiveTarget(targetName)
}

await copyManagerScript()

console.log(`Done. Release output: ${releaseRoot}`)
