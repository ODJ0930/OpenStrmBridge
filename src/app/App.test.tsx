import { render, screen } from '@testing-library/react'
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
    ['/plugins', '神医助手（适配本程序的社区开源版本）', '安装状态'],
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

  it('shows feedback after saving STRM settings', async () => {
    const user = userEvent.setup()
    renderRoute('/settings')

    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect((await screen.findAllByText('STRM 设置已保存')).length).toBeGreaterThan(0)
  })
})
