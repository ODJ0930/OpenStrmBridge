import { useEffect, useState } from 'react'
import {
  Alert,
  App as AntApp,
  AutoComplete,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Tag,
} from 'antd'
import type { ReactNode } from 'react'

import type { AiRenameSettings, AiRenameSettingsUpdate } from '../../shared/types/domain'
import type { AppIconName } from '../../shared/types/ui'
import { AppIcon } from '../../shared/ui/AppIcon'
import { settingsService } from '../settings/settingsService'
import type {
  AiRenameConnectionTestResult,
  AiRenameTmdbTestResult,
} from '../settings/settingsService'

const protectedCustomParameterNames = new Set([
  '__proto__',
  'constructor',
  'messages',
  'model',
  'prototype',
  'response_format',
  'stream',
])

function validateCustomParameters(value: string | undefined) {
  const text = value?.trim() || '{}'
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return Promise.reject(new Error('请输入有效的 JSON 对象'))
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return Promise.reject(new Error('自定义参数必须是 JSON 对象'))
  }

  const protectedName = Object.keys(parsed).find((key) => protectedCustomParameterNames.has(key))

  if (protectedName) {
    return Promise.reject(new Error(`不能覆盖受保护字段：${protectedName}`))
  }

  return Promise.resolve()
}

function SettingsSectionTitle({
  icon,
  title,
  trailing,
}: {
  icon: AppIconName
  title: string
  trailing?: ReactNode
}) {
  return (
    <div className="settings-section-title">
      <h2>
        <AppIcon name={icon} />
        {title}
      </h2>
      {trailing}
    </div>
  )
}

export function AiRenameSettingsForm() {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<AiRenameSettingsUpdate>()
  const [configured, setConfigured] = useState<AiRenameSettings>(
    settingsService.getAiRenameSettings(),
  )
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testingTmdb, setTestingTmdb] = useState(false)
  const [discoveringModels, setDiscoveringModels] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [testResult, setTestResult] = useState<AiRenameConnectionTestResult | null>(null)
  const [tmdbTestResult, setTmdbTestResult] = useState<AiRenameTmdbTestResult | null>(null)
  const tmdbEnabled = Form.useWatch('tmdbEnabled', form)

  useEffect(() => {
    let mounted = true

    async function loadSettings() {
      setLoading(true)

      try {
        const settings = await settingsService.loadSettings()

        if (!mounted) {
          return
        }

        setConfigured(settings.aiRename)
        setModelOptions(settings.aiRename.model ? [settings.aiRename.model] : [])
        form.setFieldsValue({
          apiKey: '',
          baseUrl: settings.aiRename.baseUrl,
          clearApiKey: false,
          clearTmdbToken: false,
          customParameters: settings.aiRename.customParameters,
          maxVideosPerRequest: settings.aiRename.maxVideosPerRequest,
          model: settings.aiRename.model,
          namingStyle: settings.aiRename.namingStyle,
          promptTemplate: settings.aiRename.promptTemplate,
          rebuildFolders: settings.aiRename.rebuildFolders,
          tmdbBaseUrl: settings.aiRename.tmdbBaseUrl,
          tmdbEnabled: settings.aiRename.tmdbEnabled,
          tmdbLanguage: settings.aiRename.tmdbLanguage,
          tmdbToken: '',
        })
      } catch (error) {
        if (mounted) {
          message.error(error instanceof Error ? error.message : '读取 AI 重命名设置失败')
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

  function normalizeValues(values: AiRenameSettingsUpdate): AiRenameSettingsUpdate {
    return {
      ...values,
      apiKey: values.apiKey?.trim() || undefined,
      baseUrl: values.baseUrl?.trim() || configured.baseUrl,
      customParameters: values.customParameters?.trim() || '{}',
      maxVideosPerRequest: values.maxVideosPerRequest ?? configured.maxVideosPerRequest,
      model: values.model?.trim() || configured.model,
      promptTemplate: values.promptTemplate.trim(),
      tmdbBaseUrl: values.tmdbBaseUrl?.trim() || configured.tmdbBaseUrl,
      tmdbLanguage: values.tmdbLanguage?.trim() || configured.tmdbLanguage || 'zh-CN',
      tmdbToken: values.tmdbToken?.trim() || undefined,
    }
  }

  async function handleSave(values: AiRenameSettingsUpdate) {
    setSaving(true)

    try {
      const savedSettings = await settingsService.saveAiRenameSettings(normalizeValues(values))
      setConfigured(savedSettings)
      form.setFieldsValue({
        apiKey: '',
        clearApiKey: false,
        clearTmdbToken: false,
        tmdbToken: '',
      })
      message.success('AI 重命名设置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'AI 重命名设置保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)

    try {
      await form.validateFields(['baseUrl', 'apiKey', 'model', 'customParameters'])
      const values = form.getFieldsValue(true)
      const result = await settingsService.testAiRenameSettings(normalizeValues(values))
      setTestResult(result)
      message.success(result.message)
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message)
      }
    } finally {
      setTesting(false)
    }
  }

  async function handleTestTmdb() {
    setTestingTmdb(true)

    try {
      await form.validateFields(['tmdbBaseUrl', 'tmdbToken'])
      const values = form.getFieldsValue(true)
      const result = await settingsService.testAiRenameTmdb(normalizeValues(values))
      setTmdbTestResult(result)
      message.success(result.message)
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message)
      }
    } finally {
      setTestingTmdb(false)
    }
  }

  async function handleDiscoverModels() {
    setDiscoveringModels(true)

    try {
      await form.validateFields(['baseUrl', 'apiKey'])
      const values = form.getFieldsValue(true)
      const result = await settingsService.discoverAiRenameModels(normalizeValues(values))
      const models = result.models.map((item) => item.id)

      setModelOptions(models)

      if (!form.getFieldValue('model') && models.length === 1) {
        form.setFieldValue('model', models[0])
      }

      message.success(result.message)
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message)
      }
    } finally {
      setDiscoveringModels(false)
    }
  }

  return (
    <Form
      className="ai-rename-settings-form"
      form={form}
      initialValues={{
        ...settingsService.getAiRenameSettings(),
        apiKey: '',
        clearApiKey: false,
        clearTmdbToken: false,
        tmdbToken: '',
      }}
      layout="vertical"
      disabled={loading || saving}
      onFinish={handleSave}
    >
      <section className="ai-rename-settings-section">
        <SettingsSectionTitle
          icon="bot"
          title="OpenAI 兼容接口"
          trailing={
            <Tag color={configured.apiKeyConfigured ? 'green' : 'default'}>
              {configured.apiKeyConfigured ? 'API Key 已配置' : 'API Key 未配置'}
            </Tag>
          }
        />
        <div className="ai-rename-settings-body">
          <Alert
            className="ai-rename-settings-alert"
            message="密钥仅保存在后端，浏览器读取设置时只会得到是否已配置。"
            showIcon
            type="info"
          />
          <Form.Item
            extra="填写 API 根地址，例如 https://api.openai.com/v1；后端会调用 /chat/completions。"
            label="Base URL"
            name="baseUrl"
            rules={[{ required: true, message: '请输入 AI Base URL' }]}
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            extra={configured.apiKeyConfigured ? '留空将继续使用已保存的密钥。' : undefined}
            label="API Key"
            name="apiKey"
            rules={
              configured.apiKeyConfigured ? [] : [{ required: true, message: '请输入 API Key' }]
            }
          >
            <Input.Password autoComplete="new-password" placeholder="sk-..." />
          </Form.Item>
          {configured.apiKeyConfigured ? (
            <Form.Item name="clearApiKey" valuePropName="checked">
              <Checkbox>清除已保存的 API Key</Checkbox>
            </Form.Item>
          ) : null}
          <Form.Item
            extra="可先探测接口返回的模型列表，再选择或手动输入。"
            label="模型"
            className="ai-rename-model-field"
          >
            <div className="ai-rename-model-row">
              <Form.Item
                name="model"
                noStyle
                rules={[{ required: true, message: '请选择或输入模型名称' }]}
              >
                <AutoComplete
                  aria-label="模型"
                  className="ai-rename-model-input"
                  filterOption={(inputValue, option) =>
                    String(option?.value ?? '')
                      .toLocaleLowerCase()
                      .includes(inputValue.toLocaleLowerCase())
                  }
                  options={modelOptions.map((model) => ({ value: model }))}
                  placeholder="探测接口模型或手动输入模型名称"
                />
              </Form.Item>
              <Button loading={discoveringModels} onClick={() => void handleDiscoverModels()}>
                探测模型
              </Button>
            </div>
          </Form.Item>

          <Form.Item
            extra={
              <span>
                以 JSON 对象填写，将透传到 <code>/chat/completions</code>。例如：
                <code>{' {"model_reasoning_effort":"xhigh","service_tier":"priority"}'}</code>
                。model、messages、stream 和 response_format 等核心字段不可覆盖。
              </span>
            }
            label="自定义请求参数（JSON）"
            name="customParameters"
            rules={[
              { max: 10000, message: '自定义请求参数不能超过 10000 个字符' },
              { validator: (_, value: string | undefined) => validateCustomParameters(value) },
            ]}
          >
            <Input.TextArea
              aria-label="自定义请求参数"
              className="ai-rename-json-input"
              maxLength={10000}
              placeholder={
                '{\n  "model_reasoning_effort": "xhigh",\n  "service_tier": "priority"\n}'
              }
              rows={6}
              showCount
            />
          </Form.Item>

          <Form.Item
            extra="每次提交给 AI 的视频数量上限。超过上限时会按批次顺序处理；建议根据模型上下文容量设置为 20–100。"
            label="单次 AI 请求视频上限"
            name="maxVideosPerRequest"
            rules={[
              { required: true, message: '请输入单次 AI 请求视频上限' },
              { type: 'number', min: 1, max: 1000, message: '上限必须是 1–1000 之间的整数' },
            ]}
          >
            <InputNumber
              aria-label="单次 AI 请求视频上限"
              className="ai-rename-number-input"
              max={1000}
              min={1}
              precision={0}
              placeholder="100"
              style={{ width: '100%' }}
            />
          </Form.Item>

          {testResult ? (
            <Alert
              className="ai-rename-settings-alert"
              description={
                <div className="ai-rename-test-metrics">
                  <Tag color="blue">模型：{testResult.model}</Tag>
                  <Tag color="cyan">接口延迟：{testResult.latencyMs} ms</Tag>
                  <Tag color="purple">
                    输出速度：{testResult.tokensPerSecond.toFixed(2)} tokens/s
                  </Tag>
                  <Tag>
                    输出 Token：{testResult.completionTokens}
                    {testResult.tokenCountEstimated ? '（估算）' : ''}
                  </Tag>
                </div>
              }
              message="AI 可用性测试通过"
              showIcon
              type="success"
            />
          ) : null}

          <div className="ai-rename-section-actions">
            <Button loading={testing} onClick={() => void handleTest()}>
              测试 AI 模型
            </Button>
          </div>
        </div>
      </section>

      <section className="ai-rename-settings-section">
        <SettingsSectionTitle icon="sparkles" title="AI 分析提示词" />
        <div className="ai-rename-settings-body">
          <Form.Item
            extra="该提示词会用于所有 AI 重命名任务；后端仍会附加 Emby 命名格式、结构化 JSON 输出和路径安全约束。"
            label="AI 提示词"
            name="promptTemplate"
            rules={[
              { required: true, message: '请输入 AI 提示词' },
              { whitespace: true, message: 'AI 提示词不能为空' },
              { max: 8000, message: 'AI 提示词不能超过 8000 个字符' },
            ]}
          >
            <Input.TextArea
              aria-label="AI 提示词"
              maxLength={8000}
              placeholder="请输入电影与电视剧媒体库名称分析规则"
              rows={8}
              showCount
            />
          </Form.Item>
        </div>
      </section>

      <section className="ai-rename-settings-section">
        <SettingsSectionTitle icon="folder" title="文件夹整理" />
        <div className="ai-rename-settings-body">
          <Form.Item
            extra="同时应用于电影、剧集目录、单季目录、视频文件及匹配的字幕和 NFO。"
            label="命名规则"
            name="namingStyle"
          >
            <Select
              options={[
                { label: '中文名 (English Title)', value: 'zh-en' },
                { label: 'English Title (中文名)', value: 'en-zh' },
                { label: '仅中文名', value: 'zh' },
                { label: 'English Title only', value: 'en' },
              ]}
            />
          </Form.Item>
          <Form.Item
            className="ai-rename-switch-item"
            extra="关闭时只重命名原位置中的文件和目录；开启后才会构建 Emby 推荐的“剧集名 (年份)/Season 01/剧集名 - S01E01.ext”结构，合并分散季目录且不覆盖现有目标。"
            label="重建 Emby 标准文件夹结构"
            name="rebuildFolders"
            valuePropName="checked"
          >
            <Switch
              aria-label="重建 Emby 标准文件夹结构"
              checkedChildren="开启"
              unCheckedChildren="关闭"
            />
          </Form.Item>
          <Alert
            description={
              <div>
                <div>剧集目录：剧集显示名 (首播年份)</div>
                <div>季目录：Season 01（特别篇为 Season 00）</div>
                <div>视频文件：剧集显示名 - S01E01.ext</div>
                <div>电影文件：电影显示名 (年份).ext</div>
              </div>
            }
            message="Emby 媒体输出格式"
            showIcon
            type="info"
          />
        </div>
      </section>

      <section className="ai-rename-settings-section">
        <SettingsSectionTitle
          icon="database"
          title="TMDB 校验（可选）"
          trailing={
            <Tag color={configured.tmdbTokenConfigured ? 'green' : 'default'}>
              {configured.tmdbTokenConfigured ? 'Token 已配置' : 'Token 未配置'}
            </Tag>
          }
        />
        <div className="ai-rename-settings-body">
          <Form.Item
            className="ai-rename-switch-item"
            label="启用 TMDB 校验"
            name="tmdbEnabled"
            valuePropName="checked"
          >
            <Switch aria-label="启用 TMDB 校验" checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
          {tmdbEnabled ? (
            <>
              <Form.Item
                label="TMDB Base URL"
                name="tmdbBaseUrl"
                rules={[{ required: true, message: '请输入 TMDB Base URL' }]}
              >
                <Input placeholder="https://api.themoviedb.org/3" />
              </Form.Item>
              <Form.Item
                extra={
                  configured.tmdbTokenConfigured ? '留空将继续使用已保存的 Token。' : undefined
                }
                label="TMDB Read Access Token"
                name="tmdbToken"
                rules={
                  configured.tmdbTokenConfigured
                    ? []
                    : [{ required: true, message: '请输入 TMDB Read Access Token' }]
                }
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              {configured.tmdbTokenConfigured ? (
                <Form.Item name="clearTmdbToken" valuePropName="checked">
                  <Checkbox>清除已保存的 TMDB Token</Checkbox>
                </Form.Item>
              ) : null}
              <Form.Item label="TMDB 语言" name="tmdbLanguage">
                <Input placeholder="zh-CN" />
              </Form.Item>
              {tmdbTestResult ? (
                <Alert
                  className="ai-rename-settings-alert"
                  description={
                    <div className="ai-rename-test-metrics">
                      <Tag color="cyan">接口延迟：{tmdbTestResult.latencyMs} ms</Tag>
                    </div>
                  }
                  message="TMDB 连接测试通过"
                  showIcon
                  type="success"
                />
              ) : null}
              <div className="ai-rename-section-actions">
                <Button loading={testingTmdb} onClick={() => void handleTestTmdb()}>
                  测试 TMDB
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </section>

      <div className="settings-save-row">
        <Button htmlType="submit" loading={saving} type="primary">
          保存设置
        </Button>
      </div>
    </Form>
  )
}
