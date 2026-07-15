import { useEffect, useMemo, useState } from 'react'
import { Alert, App as AntApp, Button, Input, Space, Switch, Tag } from 'antd'

import type { ApiAccessSettings } from '../../shared/types/domain'
import { AppIcon } from '../../shared/ui/AppIcon'
import { PagePanel } from '../../shared/ui/PagePanel'
import { StatCard } from '../../shared/ui/StatCard'
import { apiAccessService } from './apiAccessService'

function formatDateTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value || '未知'
  }

  return date.toLocaleString('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    year: 'numeric',
  })
}

function createCurlExamples(apiBaseUrl: string, apiKey: string) {
  const baseUrl = apiBaseUrl || 'http://127.0.0.1:5174'
  const key = apiKey || '<API_KEY>'

  return [
    {
      title: '查询任务列表',
      command: `curl -H "Authorization: Bearer ${key}" "${baseUrl}/api/tasks"`,
    },
    {
      title: '运行指定任务',
      command: `curl -X POST -H "Authorization: Bearer ${key}" "${baseUrl}/api/tasks/<TASK_ID>/run"`,
    },
    {
      title: '查询存储列表',
      command: `curl -H "X-OpenStrmBridge-Api-Key: ${key}" "${baseUrl}/api/storage"`,
    },
    {
      title: '保存 STRM 设置',
      command: [
        `curl -X PUT "${baseUrl}/api/settings/strm" \\`,
        `  -H "Authorization: Bearer ${key}" \\`,
        '  -H "Content-Type: application/json" \\',
        '  -d \'{"mediaExtensions":"mp4,mkv","minMediaSizeMb":2}\'',
      ].join('\n'),
    },
    {
      title: '同步神医助手插件参数',
      command: [
        `curl -X PUT "${baseUrl}/api/strm-assistant/plugin-settings" \\`,
        `  -H "Authorization: Bearer ${key}" \\`,
        '  -H "Content-Type: application/json" \\',
        '  -d \'{"values":{"catchup-mode":true,"extract-workers":2}}\'',
      ].join('\n'),
    },
  ]
}

const apiEndpointGroups = [
  {
    title: 'API 接口管理',
    description: '查看、开启/关闭和重置本程序外部 API 能力。',
    endpoints: [
      ['GET', '/api/access', '读取 API 开关、秘钥和生成/更新时间。'],
      ['PUT', '/api/access', '保存 API 开关状态，例如 {"enabled": true}。'],
      ['POST', '/api/access/regenerate', '重置 API 秘钥，旧秘钥立即失效。'],
      ['GET', '/api/health', '健康检查接口，不需要 API 秘钥。'],
    ],
  },
  {
    title: '任务管理',
    description: '创建、编辑、删除、运行、停止 STRM 生成任务并读取任务日志。',
    endpoints: [
      ['GET', '/api/tasks', '读取全部任务列表，包含状态、下次运行时间、最近结果和输出目录。'],
      ['PUT', '/api/tasks/{taskId}', '新增或保存指定任务，Body 为完整任务对象。'],
      ['DELETE', '/api/tasks/{taskId}', '删除指定任务记录，不删除已经生成的 STRM 文件。'],
      ['POST', '/api/tasks/{taskId}/run', '立即运行指定任务。'],
      ['POST', '/api/tasks/{taskId}/stop', '停止指定任务，将状态恢复为空闲。'],
      ['GET', '/api/tasks/{taskId}/log', '读取指定任务运行日志，运行中任务会返回实时日志。'],
      ['POST', '/api/tasks/run-all', '按当前任务列表顺序运行全部任务。'],
    ],
  },
  {
    title: '存储管理与目录浏览',
    description: '管理 OpenList / Alist、WebDAV、本地存储，并执行连接检查或目录浏览。',
    endpoints: [
      ['GET', '/api/storage', '读取全部存储配置。'],
      ['PUT', '/api/storage/{storageId}', '新增或保存指定存储，Body 为完整存储对象。'],
      ['DELETE', '/api/storage/{storageId}', '删除指定存储配置。'],
      ['POST', '/api/storage/check', '检查存储连接状态，可用于验证 Token、WebDAV 账号或本地路径。'],
      ['POST', '/api/storage/browse', '浏览指定存储目录，Body 包含 storageId 和 path。'],
      ['POST', '/api/storage/ai-rename/jobs', '创建递归 AI 重命名任务。'],
      ['GET', '/api/storage/ai-rename/jobs/{jobId}', '读取 AI 重命名任务进度和逐项结果。'],
      ['POST', '/api/storage/ai-rename/jobs/{jobId}/cancel', '停止尚未完成的重命名操作。'],
      ['POST', '/api/ai-rename/models', '探测 OpenAI 兼容接口支持的模型列表。'],
      ['POST', '/api/ai-rename/test', '测试模型可用性并返回请求耗时和输出速度。'],
      ['POST', '/api/ai-rename/tmdb/test', '单独测试 TMDB Token 与接口连通性。'],
      ['GET', '/api/ai-rename/tasks', '读取已保存的 AI 重命名任务配置和最近结果。'],
      ['PUT', '/api/ai-rename/tasks/{taskId}', '新增或更新可重复运行的 AI 重命名任务。'],
      ['DELETE', '/api/ai-rename/tasks/{taskId}', '删除 AI 重命名任务配置。'],
      ['POST', '/api/ai-rename/tasks/{taskId}/run', '运行指定 AI 重命名任务。'],
      ['POST', '/api/ai-rename/tasks/{taskId}/stop', '停止指定 AI 重命名任务。'],
      ['GET', '/api/ai-rename/tasks/{taskId}/result', '读取指定任务的最近进度与逐项结果。'],
      ['POST', '/api/ai-rename/tasks/run-all', '运行全部未在执行的 AI 重命名任务。'],
    ],
  },
  {
    title: '系统设置',
    description: '读取和更新 STRM、302 代理、Emby 授权与 Webhook 设置。',
    endpoints: [
      ['GET', '/api/settings', '读取完整系统设置，并包含 302 代理运行状态。'],
      [
        'PUT',
        '/api/settings/strm',
        '保存 STRM 设置，例如输出目录、媒体后缀、扫描线程数量和签名设置。',
      ],
      [
        'PUT',
        '/api/settings/proxy302',
        '保存 302 代理设置，并同步启动或停止 go-emby2openlist 代理。',
      ],
      ['PUT', '/api/settings/emby', '保存 Emby API Key。'],
      ['PUT', '/api/settings/webhook', '保存 Webhook URL 和删除同步开关。'],
      [
        'PUT',
        '/api/settings/ai-rename',
        '保存 OpenAI 兼容接口、自定义 Chat Completions 参数和可选 TMDB 配置。',
      ],
      ['POST', '/api/ai-rename/test', '测试 AI 与可选 TMDB 连接。'],
    ],
  },
  {
    title: '神医助手 / Emby 插件',
    description: '管理神医助手插件状态、安装路径、计划任务和手动执行。',
    endpoints: [
      ['GET', '/api/strm-assistant', '读取神医助手检测结果、功能能力、选项和计划任务状态。'],
      ['GET', '/api/emby-plugin', '读取 Emby 插件检测结果。'],
      ['PUT', '/api/strm-assistant/directory', '保存神医助手插件目录。'],
      [
        'PUT',
        '/api/strm-assistant/plugin-settings',
        '读取现有配置后写回神医助手实际插件参数，例如追更模式、线程数、媒体信息提取、片头探测和合并多版本。',
      ],
      ['PUT', '/api/strm-assistant/task-schedule', '保存神医助手计划任务触发方式。'],
      ['GET', '/api/strm-assistant/task-runs/{taskId}', '读取指定神医助手任务运行进度。'],
      ['POST', '/api/strm-assistant/task-runs/{taskId}', '立即提交指定神医助手任务。'],
      [
        'POST',
        '/api/strm-assistant/start',
        '启动或刷新神医助手插件管理；检测到已有同名插件时返回 409，可在 Body 传 {"forceReplace": true} 确认替换。',
      ],
      [
        'POST',
        '/api/emby-plugin/install',
        '安装内置 Emby 插件资源；检测到已有同名插件时返回 409，可在 Body 传 {"forceReplace": true} 删除原文件后替换。',
      ],
    ],
  },
  {
    title: '播放中转 / Webhook',
    description: '供 Emby、播放器和 Webhook 使用的运行时接口，通常不需要 API 秘钥。',
    endpoints: [
      [
        'GET/HEAD',
        '/api/strm/redirect/{storageId}/{path}',
        'STRM 中转播放接口，返回可播放直链或重定向。',
      ],
      ['GET/HEAD', '/api/openlist/direct/{storageId}/d/{path}', 'OpenList / Alist 直链兑换接口。'],
      ['POST', '/webhook/{token}', 'Emby 删除事件 Webhook，根据 URL token 鉴权。'],
    ],
  },
] as const

function getMethodColor(method: string) {
  if (method.includes('DELETE')) {
    return 'red'
  }

  if (method.includes('POST')) {
    return 'blue'
  }

  if (method.includes('PUT')) {
    return 'gold'
  }

  return 'green'
}

export function ApiAccessPage() {
  const { message, modal } = AntApp.useApp()
  const [access, setAccess] = useState<ApiAccessSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingEnabled, setSavingEnabled] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const apiBaseUrl = apiAccessService.getEndpointBaseUrl()
  const curlExamples = useMemo(
    () => createCurlExamples(apiBaseUrl, access?.key ?? ''),
    [access?.key, apiBaseUrl],
  )

  useEffect(() => {
    let mounted = true

    async function loadAccess() {
      setLoading(true)

      try {
        const result = await apiAccessService.getAccess()

        if (mounted) {
          setAccess(result)
        }
      } catch (error) {
        if (mounted) {
          message.error(error instanceof Error ? error.message : '读取 API 秘钥失败')
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    void loadAccess()

    return () => {
      mounted = false
    }
  }, [message])

  async function copyText(text: string, label: string) {
    await navigator.clipboard.writeText(text)
    message.success(`${label}已复制`)
  }

  async function handleEnabledChange(enabled: boolean) {
    setSavingEnabled(true)

    try {
      const result = await apiAccessService.update({ enabled })
      setAccess(result)
      message.success(enabled ? 'API 接口已开启' : 'API 接口已关闭')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存 API 接口开关失败')
    } finally {
      setSavingEnabled(false)
    }
  }

  function handleRegenerate() {
    modal.confirm({
      cancelText: '取消',
      content: '重置后旧 API 秘钥会立即失效，外部脚本和自动化工具需要更新为新秘钥。',
      okButtonProps: {
        danger: true,
        loading: regenerating,
      },
      okText: '确认重置',
      title: '重置 API 秘钥',
      onOk: async () => {
        setRegenerating(true)

        try {
          const result = await apiAccessService.regenerate()
          setAccess(result)
          message.success('API 秘钥已重置')
        } catch (error) {
          message.error(error instanceof Error ? error.message : '重置 API 秘钥失败')
          throw error
        } finally {
          setRegenerating(false)
        }
      },
    })
  }

  return (
    <PagePanel
      eyebrow="API"
      title="API 接口"
      subtitle="使用 API 秘钥从外部脚本或自动化工具调用 OpenStrmBridge 管理接口。"
      actions={
        <Button
          danger
          icon={<AppIcon name="refresh" />}
          loading={regenerating}
          onClick={handleRegenerate}
        >
          重置秘钥
        </Button>
      }
    >
      <div className="summary-grid summary-grid-3">
        <StatCard
          detail="Bearer / Header"
          icon="shield"
          title="API 状态"
          tone={access?.enabled === false ? 'slate' : 'green'}
          value={access ? (access.enabled ? '已开启' : '已关闭') : '加载中'}
        />
        <StatCard
          detail="自动持久化保存"
          icon="calendar"
          title="生成时间"
          tone="blue"
          value={access ? formatDateTime(access.createdAt) : '读取中'}
        />
        <StatCard
          detail="重置后旧秘钥失效"
          icon="activity"
          title="更新时间"
          tone="amber"
          value={access ? formatDateTime(access.updatedAt) : '读取中'}
        />
      </div>

      <section className="soft-card api-access-card">
        <div className="api-access-heading">
          <div>
            <h2>API 开关与当前秘钥</h2>
            <p>关闭后外部 API 调用会被拒绝，同源管理台仍可进入本页面重新开启。</p>
          </div>
          <Space>
            <Tag color={access?.enabled === false ? undefined : 'success'}>
              {access?.enabled === false ? '已关闭' : '已开启'}
            </Tag>
            <Switch
              checked={access?.enabled !== false}
              checkedChildren="开启"
              disabled={loading || !access}
              loading={savingEnabled}
              unCheckedChildren="关闭"
              onChange={(checked) => void handleEnabledChange(checked)}
            />
          </Space>
        </div>

        <Input.Password
          readOnly
          value={access?.key ?? ''}
          placeholder={loading ? '正在读取 API 秘钥...' : '暂无 API 秘钥'}
          addonAfter={
            <Button
              disabled={!access?.key}
              icon={<AppIcon name="copy" />}
              type="text"
              onClick={() => access?.key && void copyText(access.key, 'API 秘钥')}
            >
              复制
            </Button>
          }
        />

        <Alert
          showIcon
          type="info"
          message="鉴权方式"
          description={
            <Space direction="vertical" size={4}>
              <code>Authorization: Bearer &lt;API_KEY&gt;</code>
              <code>X-OpenStrmBridge-Api-Key: &lt;API_KEY&gt;</code>
            </Space>
          }
        />
      </section>

      <section className="soft-card api-endpoint-card">
        <div className="api-access-heading">
          <div>
            <h2>完整 API 功能清单</h2>
            <p>外部客户端可通过这些接口控制本程序主要功能；除特别标注外均需要 API 秘钥。</p>
          </div>
          <Tag color="processing">
            共 {apiEndpointGroups.reduce((total, group) => total + group.endpoints.length, 0)}{' '}
            个接口
          </Tag>
        </div>

        <div className="api-endpoint-group-list">
          {apiEndpointGroups.map((group) => (
            <article className="api-endpoint-group" key={group.title}>
              <header>
                <h3>{group.title}</h3>
                <p>{group.description}</p>
              </header>
              <div className="api-endpoint-list">
                {group.endpoints.map(([method, path, description]) => (
                  <div className="api-endpoint-row" key={`${method}-${path}`}>
                    <Tag color={getMethodColor(method)}>{method}</Tag>
                    <code>{path}</code>
                    <span>{description}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="soft-card api-example-card">
        <div className="api-access-heading">
          <div>
            <h2>常用 curl 示例</h2>
            <p>这些示例复用现有管理接口，可控制任务、存储和设置等功能。</p>
          </div>
          <Tag>{apiBaseUrl || '当前站点'}</Tag>
        </div>

        <div className="api-example-list">
          {curlExamples.map((example) => (
            <article className="api-example-item" key={example.title}>
              <div className="api-example-title">
                <strong>{example.title}</strong>
                <Button
                  icon={<AppIcon name="copy" />}
                  size="small"
                  onClick={() => void copyText(example.command, example.title)}
                >
                  复制
                </Button>
              </div>
              <pre>{example.command}</pre>
            </article>
          ))}
        </div>
      </section>
    </PagePanel>
  )
}
