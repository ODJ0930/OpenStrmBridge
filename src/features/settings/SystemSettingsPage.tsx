import { useEffect, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Collapse,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
} from 'antd'
import type { ReactNode } from 'react'

import { brandConfig, systemTabs } from '../../shared/config/appConfig'
import type { Proxy302Settings, StrmSettings, WebhookSettings } from '../../shared/types/domain'
import type { AppIconName, SettingsTabKey } from '../../shared/types/ui'
import { AppIcon } from '../../shared/ui/AppIcon'
import { PagePanel } from '../../shared/ui/PagePanel'
import { StatCard } from '../../shared/ui/StatCard'
import { useAuth } from '../auth/authContext'
import { authService } from '../auth/authService'
import { settingsService } from './settingsService'

const supportItems = ['Emby 媒体删除事件：同步删除远程存储（网盘）中的文件']

function SettingsSectionTitle({
  icon,
  title,
  trailing,
}: {
  icon: 'strm' | 'proxy302' | 'webhook' | 'server' | 'bot' | 'file' | 'shield' | 'info'
  title: string
  trailing?: ReactNode
}) {
  const iconName: AppIconName =
    icon === 'proxy302' ? 'server' : icon === 'webhook' ? 'bot' : icon === 'strm' ? 'file' : icon

  return (
    <div className="settings-section-title">
      <h2>
        <AppIcon name={iconName} />
        {title}
      </h2>
      {trailing}
    </div>
  )
}

function StrmSettingsTab() {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<StrmSettings>()
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const initialSettings = settingsService.getStrmSettings()
  const watchedSettings = Form.useWatch([], form) as Partial<StrmSettings> | undefined
  const currentSettings: StrmSettings = {
    ...initialSettings,
    ...watchedSettings,
  }
  const previewUrl = settingsService.createStrmPreview(currentSettings)

  useEffect(() => {
    let mounted = true

    async function loadSettings() {
      setLoading(true)

      try {
        const settings = await settingsService.loadSettings()

        if (mounted) {
          form.setFieldsValue(settings.strm)
        }
      } catch (error) {
        if (mounted) {
          message.error(error instanceof Error ? error.message : '读取 STRM 设置失败')
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    void loadSettings()

    return () => {
      mounted = false
    }
  }, [form, message])

  async function handleSave(values: StrmSettings) {
    const savedSettings = await settingsService.saveStrmSettings({
      ...values,
      previewUrl,
    })

    form.setFieldsValue(savedSettings)
    setSaved(true)
    message.success('STRM 设置已保存')
  }

  function refreshSignSecret() {
    form.setFieldsValue({
      signSecret: settingsService.createSignSecret(),
    })
    setSaved(false)
  }

  return (
    <Form
      form={form}
      initialValues={initialSettings}
      layout="vertical"
      disabled={loading}
      onFinish={handleSave}
      onValuesChange={() => setSaved(false)}
    >
      <SettingsSectionTitle icon="strm" title="扫描设置" />
      <Form.Item
        extra="多个后缀用逗号分隔，这些文件将生成 STRM"
        label="媒体文件后缀"
        name="mediaExtensions"
      >
        <Input />
      </Form.Item>
      <Form.Item extra="大于此大小的媒体文件将才会生成 STRM" label="媒体文件大小阈值">
        <Space.Compact block>
          <Button disabled>≥</Button>
          <Form.Item name="minMediaSizeMb" noStyle>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Button disabled>MB</Button>
        </Space.Compact>
      </Form.Item>
      <Form.Item
        extra="多个后缀用逗号分隔，这些文件将直接复制到生成目录"
        label="复制到本地的文件后缀"
        name="sidecarExtensions"
      >
        <Input />
      </Form.Item>

      <SettingsSectionTitle icon="file" title="生成设置" />
      <Form.Item
        extra="默认 /opt/openstrmbridge/strm，STRM 将生成至该系统目录下的 任务名 子目录"
        label="生成根目录"
        name="outputRoot"
      >
        <Input placeholder="/opt/openstrmbridge/strm" />
      </Form.Item>
      <Form.Item
        extra="默认读取当前程序所在地址，也可以按实际可访问地址手动修改，需被 Emby 访问到"
        label={`${brandConfig.name} 基础地址`}
        name="baseUrl"
      >
        <Input />
      </Form.Item>
      <Form.Item name="encodeUrl" valuePropName="checked">
        <Checkbox>对 STRM 进行 URL 编码</Checkbox>
      </Form.Item>
      <Form.Item
        extra="以文件编号替代路径写入 STRM 内容，可稍微提高扫描速度"
        label="云盘类存储生成类型"
        name="cloudNamingMode"
      >
        <Select
          options={[
            { label: '文件编号模式', value: '文件编号模式' },
            { label: '完整路径模式', value: '完整路径模式' },
          ]}
        />
      </Form.Item>
      <Form.Item name="signEnabled" valuePropName="checked">
        <Checkbox>启用签名</Checkbox>
      </Form.Item>
      <Form.Item
        extra="启用或更换密钥后，云盘类 STRM 文件需要重新生成"
        label="签名密钥"
        name="signSecret"
      >
        <Input
          suffix={
            <Button
              aria-label="刷新签名密钥"
              icon={<AppIcon name="refresh" />}
              type="text"
              onClick={refreshSignSecret}
            />
          }
        />
      </Form.Item>

      <div className="preview-block">
        <strong>生成预览</strong>
        <pre>{previewUrl}</pre>
      </div>

      {saved ? <Alert message="STRM 设置已保存" showIcon type="success" /> : null}
      <div className="settings-save-row">
        <Button htmlType="submit" type="primary">
          保存设置
        </Button>
      </div>
    </Form>
  )
}

function createProxy302Url(servicePort: number | undefined) {
  if (typeof window === 'undefined') {
    return ''
  }

  const url = new URL(window.location.origin)
  url.port = String(servicePort || 8097)
  url.pathname = '/'
  url.search = ''
  url.hash = ''

  return url.toString().replace(/\/+$/, '')
}

function getProxyRuntimeTag(settings: Proxy302Settings) {
  if (!settings.enabled) {
    return <Tag>已停用</Tag>
  }

  if (settings.runtimeStatus === 'failed') {
    return <Tag color="error">启动失败</Tag>
  }

  if (settings.healthy && settings.runtimeStatus === 'running') {
    return <Tag color="success">运行中</Tag>
  }

  if (settings.healthy !== false) {
    return <Tag color="success">已启用</Tag>
  }

  return <Tag color="processing">等待启动</Tag>
}

function Proxy302SettingsTab() {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<Proxy302Settings>()
  const [loading, setLoading] = useState(false)
  const initialSettings = settingsService.getProxy302Settings()
  const watchedSettings = Form.useWatch([], form) as Partial<Proxy302Settings> | undefined
  const currentSettings: Proxy302Settings = {
    ...initialSettings,
    ...watchedSettings,
  }
  const proxyUrl = createProxy302Url(currentSettings.servicePort)

  useEffect(() => {
    let mounted = true

    async function loadSettings() {
      setLoading(true)

      try {
        const settings = await settingsService.loadSettings()

        if (mounted) {
          form.setFieldsValue(settings.proxy302)
        }
      } catch (error) {
        if (mounted) {
          message.error(error instanceof Error ? error.message : '读取 302 代理设置失败')
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    void loadSettings()

    return () => {
      mounted = false
    }
  }, [form, message])

  async function handleSave(values: Proxy302Settings) {
    const savedSettings = await settingsService.saveProxy302Settings(values)

    form.setFieldsValue(savedSettings)
    message.success('302代理设置已保存')
  }

  function openProxyUrl() {
    if (proxyUrl) {
      window.open(proxyUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <Form
      form={form}
      initialValues={initialSettings}
      layout="vertical"
      disabled={loading}
      onFinish={handleSave}
    >
      <SettingsSectionTitle
        icon="proxy302"
        title="代理服务器"
        trailing={
          <Space>
            {getProxyRuntimeTag(currentSettings)}
            <Form.Item name="enabled" noStyle valuePropName="checked">
              <Switch checkedChildren="已启用" unCheckedChildren="已停用" />
            </Form.Item>
          </Space>
        }
      />
      <div className="status-banner">
        <AppIcon name="shield" />
        <span>
          {currentSettings.enabled
            ? `go-emby2openlist 反代入口：${proxyUrl}`
            : 'go-emby2openlist 反代已停用'}
        </span>
        <Button
          disabled={!currentSettings.enabled}
          icon={<AppIcon name="external" />}
          onClick={openProxyUrl}
          size="small"
          type="link"
        >
          打开
        </Button>
      </div>
      <Form.Item
        extra="以此端口访问反代后的 Emby；保存后后端会按该端口启动或重启内置 go-emby2openlist。"
        label="服务端口"
        rules={[{ required: true, message: '请输入服务端口' }]}
        name="servicePort"
      >
        <InputNumber max={65535} min={1} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item
        extra="填写真实 Emby 服务地址。源码部署运行在宿主机上，Docker 版 Emby 暴露端口后通常可用 http://127.0.0.1:8096。"
        label="Emby 服务地址"
        name="mediaServerUrl"
        rules={[{ required: true, message: '请输入 Emby 服务地址' }]}
      >
        <Input placeholder="http://127.0.0.1:8096" />
      </Form.Item>
      <Form.Item
        extra="用于神医助手计划任务的立即执行和进度读取，可在 Emby 控制台的 API Keys 中创建。"
        label="Emby API Key"
        name="embyApiKey"
      >
        <Input.Password placeholder="请输入 Emby API Key" />
      </Form.Item>
      <Form.Item
        extra="Emby 媒体库里看到的 STRM 根目录，例如 Docker 容器内挂载路径 /media/strm。"
        label="Emby 媒体挂载路径"
        name="mountPath"
        rules={[{ required: true, message: '请输入 Emby 媒体挂载路径' }]}
      >
        <Input placeholder="/media/strm" />
      </Form.Item>
      <Alert
        description="OpenStrmBridge 会生成 go-emby2openlist 配置并以源码方式启动代理进程；OpenList / Alist 地址和 Token 复用存储管理中已保存的信息。"
        message="使用 go-emby2openlist 源码集成"
        showIcon
        type="info"
      />
      {currentSettings.configPath ? (
        <Alert
          description={[
            `配置文件：${currentSettings.configPath}`,
            currentSettings.sourcePath ? `源码目录：${currentSettings.sourcePath}` : '',
            currentSettings.runtimeCommand ? `运行方式：${currentSettings.runtimeCommand}` : '',
          ]
            .filter(Boolean)
            .join('；')}
          message={`运行引擎：${currentSettings.engine || 'go-emby2openlist'}`}
          showIcon
          type="success"
        />
      ) : null}
      <div className="settings-save-row">
        <Button htmlType="submit" type="primary">
          保存设置
        </Button>
      </div>
    </Form>
  )
}

function WebhookSettingsTab() {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<WebhookSettings>()
  const [loading, setLoading] = useState(false)
  const initialSettings = settingsService.getWebhookSettings()

  useEffect(() => {
    let mounted = true

    async function loadSettings() {
      setLoading(true)

      try {
        const settings = await settingsService.loadSettings()

        if (mounted) {
          form.setFieldsValue(settings.webhook)
        }
      } catch (error) {
        if (mounted) {
          message.error(error instanceof Error ? error.message : '读取 Webhook 设置失败')
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    void loadSettings()

    return () => {
      mounted = false
    }
  }, [form, message])

  function copyWebhookUrl() {
    void navigator.clipboard.writeText(form.getFieldValue('url') || initialSettings.url)
    message.success('Webhook 地址已复制')
  }

  function refreshWebhookUrl() {
    const nextUrl = settingsService.createWebhookUrl(form.getFieldValue('url'))

    form.setFieldsValue({
      url: nextUrl,
    })
  }

  async function handleSave(values: WebhookSettings) {
    const savedSettings = await settingsService.saveWebhookSettings(values)

    form.setFieldsValue(savedSettings)
    message.success('Webhook 设置已保存')
  }

  return (
    <Form
      form={form}
      initialValues={initialSettings}
      layout="vertical"
      disabled={loading}
      onFinish={handleSave}
    >
      <SettingsSectionTitle icon="webhook" title="Webhook 地址" />
      <Input.Group compact className="webhook-url-group">
        <Form.Item name="url" noStyle>
          <Input readOnly />
        </Form.Item>
        <Button
          aria-label="刷新 Webhook token"
          icon={<AppIcon name="refresh" />}
          onClick={refreshWebhookUrl}
        />
        <Button
          aria-label="复制 Webhook 地址"
          icon={<AppIcon name="copy" />}
          onClick={copyWebhookUrl}
        />
      </Input.Group>
      <p className="field-help">以上链接含 token 信息，用于验证身份，请勿泄露</p>

      <section className="support-card">
        <header>
          <strong>当前支持</strong>
        </header>
        <ul>
          {supportItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <Collapse
        className="webhook-collapse"
        defaultActiveKey={['emby']}
        items={[
          {
            key: 'emby',
            label: 'Emby 删除同步设置',
            children: (
              <div>
                <Form.Item name="embyDeleteSync" valuePropName="checked">
                  <Switch checkedChildren="启用" unCheckedChildren="停用" />
                </Form.Item>
                <p className="danger-help">
                  注意：当 Emby 监控到本地 STRM
                  文件消失时，也会触发远程删除，请在明确目录映射时启用。
                </p>
              </div>
            ),
          },
        ]}
      />

      <div className="settings-save-row">
        <Button htmlType="submit" type="primary">
          保存设置
        </Button>
      </div>
    </Form>
  )
}

interface AccountSettingsFormValues {
  currentPassword: string
  username: string
  password: string
  confirmPassword: string
}

function AccountSecuritySettingsTab() {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<AccountSettingsFormValues>()
  const [saved, setSaved] = useState(false)
  const { session, updateCredentials } = useAuth()
  const accountSettings = authService.getAccountSettings()

  useEffect(() => {
    form.setFieldsValue({
      username: authService.getAccountSettings().username,
    })
  }, [form, session?.username])

  function handleSave(values: AccountSettingsFormValues) {
    try {
      updateCredentials({
        currentPassword: values.currentPassword,
        password: values.password,
        username: values.username,
      })

      form.setFieldsValue({
        confirmPassword: '',
        currentPassword: '',
        password: '',
        username: values.username.trim(),
      })
      setSaved(true)
      message.success('账号密码已更新')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '账号密码更新失败'

      form.setFields([
        {
          errors: [errorMessage],
          name: 'currentPassword',
        },
      ])
      message.error(errorMessage)
    }
  }

  return (
    <Form
      form={form}
      initialValues={{
        username: accountSettings.username,
      }}
      layout="vertical"
      onFinish={handleSave}
      onValuesChange={() => setSaved(false)}
    >
      <SettingsSectionTitle icon="shield" title="账号安全" />
      <div className="account-settings-grid">
        <Form.Item label="当前登录账号">
          <Input disabled value={session?.username ?? accountSettings.username} />
        </Form.Item>
        <Form.Item
          label="当前密码"
          name="currentPassword"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password
            autoComplete="current-password"
            placeholder="请输入当前密码"
            prefix={<AppIcon name="lock" />}
          />
        </Form.Item>
        <Form.Item
          label="新账号"
          name="username"
          rules={[{ required: true, message: '请输入新账号' }]}
        >
          <Input
            autoComplete="username"
            placeholder="请输入新账号"
            prefix={<AppIcon name="user" />}
          />
        </Form.Item>
        <Form.Item
          label="新密码"
          name="password"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '新密码至少 6 位' },
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder="请输入新密码"
            prefix={<AppIcon name="lock" />}
          />
        </Form.Item>
        <Form.Item
          dependencies={['password']}
          label="确认新密码"
          name="confirmPassword"
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve()
                }

                return Promise.reject(new Error('两次输入的新密码不一致'))
              },
            }),
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder="请再次输入新密码"
            prefix={<AppIcon name="lock" />}
          />
        </Form.Item>
      </div>

      {saved ? (
        <Alert message="账号密码已保存，下次登录将使用新凭据" showIcon type="success" />
      ) : null}
      <div className="settings-save-row">
        <Button htmlType="submit" icon={<AppIcon name="shield" />} type="primary">
          保存账号密码
        </Button>
      </div>
    </Form>
  )
}

function AboutTab() {
  return (
    <div className="about-page">
      <section className="about-overview">
        <div className="about-title-block">
          <span className="about-mark">
            <AppIcon name="info" size={20} />
          </span>
          <div>
            <span className="about-kicker">项目说明</span>
            <h2>{brandConfig.name}</h2>
            <p>
              {brandConfig.name} 的整理方式参考了 OStrm 和 go-emby2openlist 的思路，把存储接入、
              STRM 生成、Webhook 触发和 Emby 302 代理集中到一个本地控制台里。
            </p>
          </div>
        </div>
        <dl className="about-version-list">
          <div>
            <dt>项目版本</dt>
            <dd>{brandConfig.version}</dd>
          </div>
          <div>
            <dt>参考项目</dt>
            <dd>OStrm / go-emby2openlist</dd>
          </div>
        </dl>
      </section>
      <section className="about-meta-grid" aria-label="参考来源">
        <div>
          <span>OStrm</span>
          <strong>参考 STRM 生成、任务组织和本地管理的产品思路。</strong>
        </div>
        <div>
          <span>go-emby2openlist</span>
          <strong>参考 Emby 与 OpenList 联动、302 代理播放的实现思路。</strong>
        </div>
      </section>
    </div>
  )
}

function renderTabContent(key: SettingsTabKey) {
  switch (key) {
    case 'strm':
      return <StrmSettingsTab />
    case 'proxy302':
      return <Proxy302SettingsTab />
    case 'webhook':
      return <WebhookSettingsTab />
    case 'account':
      return <AccountSecuritySettingsTab />
    case 'about':
      return <AboutTab />
  }
}

export function SystemSettingsPage() {
  return (
    <PagePanel
      className="settings-panel"
      compact
      eyebrow="Settings"
      subtitle="集中调整生成、代理、Webhook 和项目说明。"
      title="系统设置"
    >
      <div className="summary-grid">
        <StatCard detail="媒体后缀、签名、输出目录" icon="file" title="STRM 设置" value="生成" />
        <StatCard
          detail="go-emby2openlist 入口"
          icon="server"
          title="302代理"
          tone="cyan"
          value="代理"
        />
        <StatCard
          detail="删除同步与回调地址"
          icon="bot"
          title="Webhook"
          tone="violet"
          value="回调"
        />
        <StatCard detail="登录账号与密码" icon="shield" title="账号安全" tone="rose" value="安全" />
      </div>

      <div className="soft-card settings-tabs-card">
        <Tabs
          defaultActiveKey="strm"
          items={systemTabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            children: renderTabContent(tab.key),
          }))}
        />
      </div>
    </PagePanel>
  )
}
