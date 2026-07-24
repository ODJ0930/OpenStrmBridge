import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { AuthProvider } from '../features/auth/AuthProvider'
import { authService } from '../features/auth/authService'
import { AppProviders } from './providers'
import { AppRoutes } from './routes'

function renderRoute(path: string, options: { authenticated?: boolean } = {}) {
  const authenticated = options.authenticated ?? true

  if (authenticated) {
    authService.login({
      password: 'openstrmbridge',
      remember: true,
      username: 'admin',
    })
  }

  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </AppProviders>,
  )
}

describe('OpenStrmBridge shell', () => {
  beforeEach(() => {
    window.__OPENSTRMBRIDGE_RUNTIME_CONFIG__ = {}
    authService.logout()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('renders the login page when no session exists', () => {
    renderRoute('/tasks', { authenticated: false })

    expect(screen.getByRole('heading', { name: '登录 OpenStrmBridge' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('请输入账号')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('请输入密码')).toBeInTheDocument()
  })

  it('signs in with account and password', async () => {
    const user = userEvent.setup()
    renderRoute('/login', { authenticated: false })

    await user.type(screen.getByPlaceholderText('请输入账号'), 'admin')
    await user.type(screen.getByPlaceholderText('请输入密码'), 'openstrmbridge')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    expect(await screen.findByRole('heading', { name: '任务管理' })).toBeInTheDocument()
  })

  it('uses runtime credentials when the runtime revision changes', async () => {
    const user = userEvent.setup()

    window.localStorage.setItem(
      'openstrmbridge.auth.credentials',
      JSON.stringify({
        password: 'old-password',
        username: 'old-user',
      }),
    )
    window.localStorage.setItem('openstrmbridge.auth.credentials-revision', 'old-revision')
    window.__OPENSTRMBRIDGE_RUNTIME_CONFIG__ = {
      auth: {
        password: 'runtime-password',
        revision: 'runtime-revision',
        username: 'runtime-user',
      },
    }

    renderRoute('/login', { authenticated: false })

    await user.type(screen.getByPlaceholderText('请输入账号'), 'runtime-user')
    await user.type(screen.getByPlaceholderText('请输入密码'), 'runtime-password')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    expect(await screen.findByRole('heading', { name: '任务管理' })).toBeInTheDocument()
  })

  it('returns to login after logout', async () => {
    const user = userEvent.setup()
    renderRoute('/tasks')

    await user.click(screen.getByRole('button', { name: '退出' }))

    expect(await screen.findByRole('heading', { name: '登录 OpenStrmBridge' })).toBeInTheDocument()
  })

  it('updates account credentials from system settings', async () => {
    const user = userEvent.setup()
    renderRoute('/settings')

    await user.click(screen.getByRole('tab', { name: '账号安全' }))
    await user.type(screen.getByPlaceholderText('请输入当前密码'), 'openstrmbridge')
    await user.clear(screen.getByPlaceholderText('请输入新账号'))
    await user.type(screen.getByPlaceholderText('请输入新账号'), 'owner')
    await user.type(screen.getByPlaceholderText('请输入新密码'), 'newpass123')
    await user.type(screen.getByPlaceholderText('请再次输入新密码'), 'newpass123')
    await user.click(screen.getByRole('button', { name: '保存账号密码' }))

    expect(await screen.findByText('账号密码已保存，下次登录将使用新凭据')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '退出' }))
    await user.type(screen.getByPlaceholderText('请输入账号'), 'owner')
    await user.type(screen.getByPlaceholderText('请输入密码'), 'newpass123')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    expect(await screen.findByRole('heading', { name: '任务管理' })).toBeInTheDocument()
  })

  it.each([
    ['/tasks', '任务管理', '任务总数'],
    ['/storage', '存储管理', '存储总数'],
    ['/browser', '存储浏览', '当前存储'],
    ['/ai-rename', 'AI 自动重命名', 'OpenAI 兼容接口'],
    ['/ai-rename-tasks', 'AI 重命名任务管理', '任务总数'],
    ['/plugins', '神医助手（适配本程序的社区开源版本）', '安装状态'],
    ['/api-access', 'API 接口', 'API 状态'],
    ['/settings', '系统设置', 'Webhook'],
  ])('renders the refreshed dashboard shell for %s', (path, heading, summaryLabel) => {
    renderRoute(path)

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getAllByText(summaryLabel).length).toBeGreaterThan(0)
  })

  it('renders the task navigation and task table', async () => {
    renderRoute('/tasks')

    expect(screen.getAllByText('OpenStrmBridge').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: '任务管理' })).toBeInTheDocument()
    expect(
      await screen.findByText('暂无任务，请先添加任务并选择一个已配置的存储'),
    ).toBeInTheDocument()
  })

  it('renders the storage table without preset addresses', async () => {
    const user = userEvent.setup()
    renderRoute('/storage')

    expect(screen.getByRole('heading', { name: '存储管理' })).toBeInTheDocument()
    expect(screen.getByText('暂无存储，请点击添加存储并填写自己的地址或路径')).toBeInTheDocument()
    expect(screen.queryByText(/^https?:\/\//)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '添加存储' }))

    expect(screen.getByPlaceholderText('请输入 OpenList / Alist 服务地址')).toHaveValue('')
    expect(screen.queryByText(/^方式[1-3]$/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /保\s*存/ }))

    expect(screen.queryByText('请选择接入方式')).not.toBeInTheDocument()
    expect(await screen.findByText('请输入存储名')).toBeInTheDocument()
  })

  it('filters file browser entries by the current directory search', async () => {
    const user = userEvent.setup()
    renderRoute('/browser')

    await user.type(screen.getByPlaceholderText('搜索当前目录...'), 'poster')

    expect(screen.getByText('poster.jpg')).toBeInTheDocument()
    expect(screen.queryByText('电影')).not.toBeInTheDocument()
  })

  it('shows AI rename settings directly without task execution panels', async () => {
    renderRoute('/ai-rename')

    expect(await screen.findByRole('heading', { name: 'OpenAI 兼容接口' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI 分析提示词' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '文件夹整理' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'TMDB 校验（可选）' })).toBeInTheDocument()
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1')
    expect(screen.getByLabelText('API Key')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '模型' })).toBeInTheDocument()
    expect(screen.getByLabelText('自定义请求参数')).toHaveValue('{}')
    expect(screen.getByLabelText('单次 AI 请求视频上限')).toHaveValue('100')
    expect(screen.getByLabelText('AI 提示词')).toBeInTheDocument()
    expect(screen.getByLabelText('命名规则')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '重建 Emby 标准文件夹结构' })).not.toBeChecked()
    expect(screen.getByText('Emby 媒体输出格式')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI 设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /选择目标目录/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /任务进度与结果/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '开始 AI 自动重命名' })).not.toBeInTheDocument()
  })

  it('saves the editable prompt together with AI rename settings', async () => {
    const user = userEvent.setup()
    renderRoute('/ai-rename')

    const prompt = await screen.findByLabelText('AI 提示词')
    expect((prompt as HTMLTextAreaElement).value).toContain('电影与电视剧媒体库命名分析器')

    await user.type(screen.getByLabelText('API Key'), 'secret-key')
    await user.type(screen.getByRole('combobox', { name: '模型' }), 'test-model')
    const customParameters = screen.getByLabelText('自定义请求参数')
    await user.clear(customParameters)
    await user.click(customParameters)
    await user.paste('{"model_reasoning_effort":"xhigh","service_tier":"priority"}')
    await user.clear(prompt)
    await user.type(prompt, '优先识别正式剧名，无法确认时跳过。')
    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect(await screen.findByText('AI 重命名设置已保存')).toBeInTheDocument()
    expect(prompt).toHaveValue('优先识别正式剧名，无法确认时跳过。')
    expect(customParameters).toHaveValue(
      '{"model_reasoning_effort":"xhigh","service_tier":"priority"}',
    )
    expect(screen.getByText('API Key 已配置')).toBeInTheDocument()
    expect(screen.getByLabelText('API Key')).toHaveValue('')
  })

  it('rejects protected AI custom request fields', async () => {
    const user = userEvent.setup()
    renderRoute('/ai-rename')

    await user.type(await screen.findByLabelText('API Key'), 'secret-key')
    await user.type(screen.getByRole('combobox', { name: '模型' }), 'test-model')
    const customParameters = screen.getByLabelText('自定义请求参数')
    await user.clear(customParameters)
    await user.click(customParameters)
    await user.paste('{"model":"forbidden"}')
    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect(await screen.findByText('不能覆盖受保护字段：model')).toBeInTheDocument()
    expect(screen.queryByText('AI 重命名设置已保存')).not.toBeInTheDocument()
  })

  it('adds a reusable AI rename task from task management', async () => {
    const user = userEvent.setup()
    renderRoute('/ai-rename-tasks')

    expect(await screen.findByText('暂无 AI 重命名任务，请点击添加任务')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '添加任务' }))
    await user.type(screen.getByLabelText('任务名称'), '整理电视剧')
    await user.click(screen.getByRole('combobox', { name: '存储' }))
    await user.click(await screen.findByRole('option', { name: '示例存储' }))

    const targetPathInput = screen.getByLabelText('目标目录')
    expect(targetPathInput).toHaveAttribute('readonly')
    await user.click(targetPathInput)

    const pathPickerTitle = await screen.findByText(/选择目标目录 - 示例存储/)
    const pathPicker = pathPickerTitle.closest<HTMLElement>('[role="dialog"]')
    expect(pathPicker).not.toBeNull()
    if (!pathPicker) throw new Error('目录选择器未打开')
    await user.click(await within(pathPicker).findByText('光鸭'))
    await user.click(within(pathPicker).getByRole('button', { name: '选择此文件夹' }))

    expect(targetPathInput).toHaveValue('/光鸭')
    await user.click(screen.getByRole('button', { name: '保存任务' }))

    expect(await screen.findByText('AI 重命名任务已添加')).toBeInTheDocument()
    expect(await screen.findByText('整理电视剧')).toBeInTheDocument()
    expect((await screen.findAllByText('/光鸭')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '查看运行日志' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^运\s*行$/ }))

    const logTitle = await screen.findByText('AI 重命名运行日志与结果')
    const logDialog = logTitle.closest<HTMLElement>('[role="dialog"]')
    expect(logDialog).not.toBeNull()
    if (!logDialog) throw new Error('运行日志未打开')
    expect(
      within(logDialog).getByText('当前处理源路径（最终路径见日志“目标”）'),
    ).toBeInTheDocument()
    expect(
      within(logDialog).getByText('AI 已返回整批建议，正在逐项修改第 1/1 个目录'),
    ).toBeInTheDocument()
    expect(within(logDialog).getAllByText(/\/光鸭/).length).toBeGreaterThan(0)
  })

  it('discovers models and reports AI latency and token speed', async () => {
    const user = userEvent.setup()
    renderRoute('/ai-rename')

    await user.type(await screen.findByLabelText('API Key'), 'test-secret')
    await user.click(screen.getByRole('button', { name: '探测模型' }))

    expect(await screen.findByText('已探测到 2 个模型')).toBeInTheDocument()

    await user.type(screen.getByRole('combobox', { name: '模型' }), 'test-model')
    await user.click(screen.getByRole('button', { name: '测试 AI 模型' }))

    expect(await screen.findByText('AI 可用性测试通过')).toBeInTheDocument()
    expect(screen.getByText('接口延迟：320 ms')).toBeInTheDocument()
    expect(screen.getByText('输出速度：75.00 tokens/s')).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: '启用 TMDB 校验' }))
    await user.type(screen.getByLabelText('TMDB Read Access Token'), 'tmdb-token')
    await user.click(screen.getByRole('button', { name: '测试 TMDB' }))

    expect((await screen.findAllByText('TMDB 连接测试通过')).length).toBeGreaterThan(0)
    expect(screen.getByText('接口延迟：95 ms')).toBeInTheDocument()
  })

  it('saves AI rename settings without echoing the API key', async () => {
    const user = userEvent.setup()
    renderRoute('/ai-rename')

    await user.type(await screen.findByLabelText('API Key'), 'secret-key')
    await user.type(screen.getByRole('combobox', { name: '模型' }), 'test-model')
    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect(await screen.findByText('API Key 已配置')).toBeInTheDocument()
    expect(screen.getByLabelText('API Key')).toHaveValue('')
  })

  it('removes the duplicate AI rename tab from system settings', () => {
    renderRoute('/settings')

    expect(screen.queryByRole('tab', { name: 'AI 重命名' })).not.toBeInTheDocument()
  })

  it('shows feedback after saving STRM settings', async () => {
    const user = userEvent.setup()
    renderRoute('/settings')

    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect((await screen.findAllByText('STRM 设置已保存')).length).toBeGreaterThan(0)
  })
})
