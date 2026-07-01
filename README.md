<p align="center">
  <img src="./public/openstrmbridge-readme.png" width="168" alt="OpenStrmBridge logo" />
</p>

<h1 align="center">OpenStrmBridge</h1>

<p align="center">
  面向家庭影音库的 STRM 生成、存储管理与 Emby 302 代理控制台。
</p>

<p align="center">
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-GPL--3.0-orange" /></a>
  <img alt="status" src="https://img.shields.io/badge/status-early_preview-1677ff" />
  <img alt="frontend" src="https://img.shields.io/badge/frontend-React%2019-22c7e8" />
  <img alt="backend" src="https://img.shields.io/badge/backend-Node.js-20a66a" />
  <img alt="proxy" src="https://img.shields.io/badge/proxy-go--emby2openlist-7c5cff" />
</p>

---

OpenStrmBridge 把 OpenList / Alist、WebDAV、本地文件、STRM 生成任务、Webhook 删除同步、Emby 302 代理和神医助手管理集中到一个本地管理台里。它内置 `go-emby2openlist` 源码和神医助手插件资源，目标是让媒体库的远程文件接入、STRM 输出和部署维护更清晰。

## 亮点

| 能力      | 说明                                                                 |
| --------- | -------------------------------------------------------------------- |
| 存储管理  | 支持 OpenList / Alist、WebDAV、本地文件三种接入方式                  |
| 存储浏览  | 浏览远端目录、进入目录、返回上级、刷新和选择路径                     |
| 任务管理  | 按存储路径生成 STRM，支持增量生成、目录时间检查、OpenList 缓存预刷新 |
| 自动调度  | 后端定时检查到期任务并自动执行，执行后刷新下次运行时间               |
| Emby 代理 | 集成 go-emby2openlist 源码，托管启动 302 代理入口                    |
| 神医助手  | 内置 StrmAssistantLite.dll，支持插件安装、功能开关和计划任务配置     |
| 系统设置  | 管理 STRM 根目录、基础地址、Webhook、302 代理和登录账号密码          |

## 功能预览

| 任务管理                                          | 存储管理                                         |
| ------------------------------------------------- | ------------------------------------------------ |
| ![任务管理](./public/readme/preview-tasks.png)    | ![存储管理](./public/readme/preview-storage.png) |
| 存储浏览                                          | 神医助手                                         |
| ![存储浏览](./public/readme/preview-browser.png)  | ![神医助手](./public/readme/preview-plugins.png) |
| 系统设置                                          |                                                  |
| ![系统设置](./public/readme/preview-settings.png) |                                                  |

## 技术栈

| 层级     | 技术                                                 |
| -------- | ---------------------------------------------------- |
| Frontend | Vite, React, TypeScript, Ant Design 5                |
| Backend  | Node.js 原生 HTTP 服务                               |
| Proxy    | vendored go-emby2openlist source, 通过 `go run` 启动 |
| Tooling  | pnpm, ESLint, Prettier, Vitest                       |

## 快速开始

### Debian / Ubuntu 一键脚本

```bash
curl -fsSL https://raw.githubusercontent.com/ODJ0930/OpenStrmBridge/main/scripts/openstrmbridge-manager.sh | sudo bash
```

或：

```bash
wget -qO- https://raw.githubusercontent.com/ODJ0930/OpenStrmBridge/main/scripts/openstrmbridge-manager.sh | sudo bash
```

脚本功能：

| 功能         | 说明                                     |
| ------------ | ---------------------------------------- |
| 安装 / 重装  | 下载对应架构的编译包，创建 systemd 服务  |
| 启动服务     | 启动 OpenStrmBridge systemd 服务         |
| 关闭服务     | 停止 OpenStrmBridge systemd 服务         |
| 更新程序     | 拉取最新 Release 编译包，保留本地数据    |
| 更换端口     | 更新服务端口并同步回调地址               |
| 重置账号密码 | 写入运行时账号配置，下一次打开页面后生效 |
| 删除程序     | 停止服务并删除安装目录、服务和环境配置   |

脚本会在菜单顶部显示安装状态和运行状态，并在启动或关闭服务后刷新状态。

安装流程会要求设置账号名称和密码，并在账号配置写入后询问是否调整默认端口。

一键脚本安装的服务默认监听 `0.0.0.0`。

### 前置依赖

- Node.js 20+
- pnpm
- Go 1.22+，用于启动内置的 go-emby2openlist / Ge2o 代理

### 安装依赖

```bash
pnpm install
```

### 启动开发环境

终端 1：启动后端。后端负责存储检查、STRM 生成、保存配置、任务调度，并在 302 代理启用时自动启动 Ge2o。

```bash
pnpm backend:dev
```

终端 2：启动前端管理台。

```bash
pnpm dev
```

默认访问地址：

| 服务                             | 地址                    |
| -------------------------------- | ----------------------- |
| 前端管理台                       | `http://127.0.0.1:5173` |
| OpenStrmBridge 后端              | `http://127.0.0.1:5174` |
| Ge2o / go-emby2openlist 代理入口 | `http://127.0.0.1:8097` |

默认登录账号：

```text
账号：admin
密码：openstrmbridge
```

进入系统后建议先到「系统设置 / 账号安全」修改账号密码。

## 初次配置

1. 在「存储管理」添加 OpenList / Alist、WebDAV 或本地文件存储。
2. 在「系统设置」保存 STRM 生成根目录和 OpenStrmBridge 基础地址。
3. 在「系统设置 / 302代理」填写 Emby 服务地址，并确认代理入口端口。
4. 在「任务管理」选择存储路径，创建 STRM 生成任务。
5. 手动运行一次任务确认输出，之后交给后台调度器按 cron 自动执行。

## 目录结构

```text
src/
  app/        # React 入口、路由和 Provider
  features/   # 任务、存储、浏览、插件、设置等业务模块
  shared/     # 配置、通用组件、领域类型
  styles/     # 全局样式和布局

server/
  storage-check-server.mjs  # 本地后端、存储检查、任务生成、调度器、ge2o 启动管理

vendor/
  go-emby2openlist/         # 内置 go-emby2openlist 源码

resources/
  emby-plugins/StrmAssistantLite.dll  # 内置神医助手插件资源

data/                       # 运行时数据目录，默认被 .gitignore 忽略
```

## Ge2o 代理

```text
vendor/go-emby2openlist
```

当后端启动且 302 代理启用时，会自动执行类似下面的命令：

```bash
go run . -p 8097 -ps 8094 -dr data/go-emby2openlist
```

参数含义：

| 参数                        | 说明                   |
| --------------------------- | ---------------------- |
| `-p 8097`                   | Emby 代理入口端口      |
| `-ps 8094`                  | Ge2o 的 HTTPS 端口占位 |
| `-dr data/go-emby2openlist` | Ge2o 运行时目录        |

后端会自动维护这些文件：

```text
data/go-emby2openlist/config.yml
data/go-emby2openlist/custom-css/openstrmbridge-emby-cleanup.css
data/go-emby2openlist/custom-js/openstrmbridge-emby-cleanup.js
```

`config.yml` 来自系统设置和存储管理。请不要手动编辑后再保存前端设置，否则会被重新生成。

## 神医助手

OpenStrmBridge 已内置神医助手插件资源：

```text
resources/emby-plugins/StrmAssistantLite.dll
```

编译发行包同样包含该文件，并通过「神医助手」页面完成插件目录定位、安装状态检测、功能开关和计划任务配置。

## Debian 部署要点

Debian 上建议将项目放在固定目录，例如：

```bash
/opt/openstrmbridge
```

默认 STRM 生成根目录：

```bash
/opt/openstrmbridge/strm
```

Emby 如果运行在 Docker 中，需要把宿主机 STRM 目录挂载到 Emby 容器内，例如：

```text
/opt/openstrmbridge/strm:/media/strm
```

然后在 OpenStrmBridge 的 302 代理设置中将 `Emby 媒体挂载路径` 填为：

```text
/media/strm
```

生产部署时建议后续使用 systemd 管理 OpenStrmBridge 后端进程。Ge2o 不需要单独写服务，因为它由 OpenStrmBridge 后端托管启动和重启。

## 停止服务

开发环境中，直接停止两个终端即可。若需要在 Windows PowerShell 中按端口强制停止当前开发进程：

```powershell
$ports = 5173, 5174, 8097
$processIds = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($processId in $processIds) {
  if ($processId) {
    Stop-Process -Id $processId -Force
  }
}
```

Linux / Debian 上如果是手动启动的开发进程，可以按进程名停止：

```bash
pkill -f "vite"
pkill -f "server/storage-check-server.mjs"
pkill -f "go run . -p 8097"
```

## 环境变量

| 变量                                        | 默认值                     | 说明                                        |
| ------------------------------------------- | -------------------------- | ------------------------------------------- |
| `OPENSTRMBRIDGE_BACKEND_HOST`               | `127.0.0.1`                | OpenStrmBridge 后端监听地址                 |
| `OPENSTRMBRIDGE_BACKEND_PORT`               | `5174`                     | OpenStrmBridge 后端端口                     |
| `OPENSTRMBRIDGE_DATA_DIR`                   | `data`                     | 运行时数据目录                              |
| `OPENSTRMBRIDGE_RUNTIME_CONFIG_FILE`        | `data/runtime-config.json` | 运行时前端配置文件                          |
| `OPENSTRMBRIDGE_GE2O_SOURCE_DIR`            | `vendor/go-emby2openlist`  | go-emby2openlist 源码目录                   |
| `OPENSTRMBRIDGE_BACKEND_PUBLIC_URL`         | `http://127.0.0.1:5174`    | ge2o 回调 OpenStrmBridge 直链兑换接口的地址 |
| `OPENSTRMBRIDGE_STRM_DIR`                   | `/opt/openstrmbridge/strm` | STRM 生成根目录                             |
| `OPENSTRMBRIDGE_EMBY_MOUNT_PATH`            | `/media/strm`              | Emby 看到的 STRM 根目录                     |
| `OPENSTRMBRIDGE_TASK_SCHEDULER_INTERVAL_MS` | `60000`                    | 后台任务调度器检查间隔；设为 `0` 可停用     |
| `VITE_OPENSTRMBRIDGE_API_BASE_URL`          | `http://127.0.0.1:5174`    | 前端访问后端 API 的地址                     |
| `VITE_OPENSTRMBRIDGE_LOGIN_USER`            | `admin`                    | 首次构建时的默认登录账号                    |
| `VITE_OPENSTRMBRIDGE_LOGIN_PASSWORD`        | `openstrmbridge`           | 首次构建时的默认登录密码                    |

## 开发命令

```bash
pnpm dev          # 启动前端开发服务器
pnpm backend:dev  # 启动本地后端
pnpm lint         # ESLint 检查
pnpm lint:fast    # oxlint 快速检查
pnpm typecheck    # TypeScript 检查
pnpm test         # Vitest 测试
pnpm build        # 生产构建
```

## 便携发行包

项目支持生成“不需要安装依赖”的便携目录。发行包会内置：

- 前端 `dist/` 静态页面
- OpenStrmBridge 后端脚本
- 对应平台的 Node.js 运行时
- 对应平台预编译的 go-emby2openlist / Ge2o 二进制
- 内置神医助手插件资源 `resources/emby-plugins/StrmAssistantLite.dll`
- 启动脚本和运行时资源

生成当前系统的发行包：

```bash
pnpm package:current
```

生成所有预设平台的发行包：

```bash
pnpm package:all
```

支持的平台：

| 包名                         | 适用系统            |
| ---------------------------- | ------------------- |
| `openstrmbridge-win-x64`     | Windows x64         |
| `openstrmbridge-linux-x64`   | Linux x64           |
| `openstrmbridge-linux-arm64` | Linux ARM64         |
| `openstrmbridge-macos-x64`   | macOS Intel         |
| `openstrmbridge-macos-arm64` | macOS Apple Silicon |

输出目录：

```text
release/
```

运行方式：

| 系统          | 启动方式          |
| ------------- | ----------------- |
| Windows       | 双击 `start.cmd`  |
| Linux / macOS | 执行 `./start.sh` |

启动后访问：

```text
http://127.0.0.1:5174
```

说明：不同操作系统需要不同的发行包，不能用一个二进制同时覆盖 Windows、Linux 和 macOS。Linux 包面向常规 glibc 发行版；Alpine Linux 这类 musl 环境建议单独构建。

## 上游项目

- [go-emby2openlist](https://github.com/AmbitiousJun/go-emby2openlist)
- [OStrm](https://github.com/hienao/ostrm)
- [StrmAssistant](https://github.com/sjtuross/StrmAssistant)

感谢上游项目提供的核心代理能力。OpenStrmBridge 的目标是围绕 STRM 生成、存储管理和部署体验做进一步整合。

## License

OpenStrmBridge is licensed under the GNU General Public License v3.0 only.

See [LICENSE](./LICENSE) for the full license text.
