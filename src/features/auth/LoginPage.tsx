import { useState } from 'react'
import { App as AntApp, Button, Checkbox, Form, Input } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'

import { routes, brandConfig } from '../../shared/config/appConfig'
import { AppIcon } from '../../shared/ui/AppIcon'
import { BrandMark } from '../../shared/ui/BrandMark'
import { useAuth } from './authContext'
import type { LoginCredentials } from './authService'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '登录失败'
}

function getRedirectPath(state: unknown) {
  const fromPath =
    typeof state === 'object' &&
    state !== null &&
    'from' in state &&
    typeof state.from === 'object' &&
    state.from !== null &&
    'pathname' in state.from &&
    typeof state.from.pathname === 'string'
      ? state.from.pathname
      : routes.tasks.path

  return fromPath === '/login' ? routes.tasks.path : fromPath
}

export function LoginPage() {
  const [form] = Form.useForm<LoginCredentials>()
  const [submitting, setSubmitting] = useState(false)
  const { message } = AntApp.useApp()
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  function handleFinish(values: LoginCredentials) {
    setSubmitting(true)

    try {
      login(values)
      message.success('登录成功')
      navigate(getRedirectPath(location.state), { replace: true })
    } catch (error) {
      message.error(getErrorMessage(error))
      form.setFields([
        {
          errors: [getErrorMessage(error)],
          name: 'password',
        },
      ])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-visual" aria-label="OpenStrmBridge">
        <div className="login-brand-stack">
          <BrandMark />
          <div>
            <strong>{brandConfig.name}</strong>
            <span>STRM 管理控制台</span>
          </div>
        </div>

        <div className="login-visual-copy">
          <span>本地媒体桥接</span>
          <h2>进入工作台</h2>
          <p>管理任务、存储、目录浏览与代理设置。</p>
        </div>

        <div className="login-status-grid">
          <div>
            <AppIcon name="tasks" />
            <span>任务编排</span>
          </div>
          <div>
            <AppIcon name="database" />
            <span>存储索引</span>
          </div>
          <div>
            <AppIcon name="shield" />
            <span>会话保护</span>
          </div>
        </div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-panel-header">
          <div className="login-panel-icon">
            <AppIcon name="shield" size={22} />
          </div>
          <div>
            <span>欢迎回来</span>
            <h1 id="login-title">登录 OpenStrmBridge</h1>
          </div>
        </div>

        <Form
          form={form}
          className="login-form"
          initialValues={{ remember: true }}
          layout="vertical"
          requiredMark={false}
          onFinish={handleFinish}
        >
          <Form.Item label="账号" name="username" rules={[{ required: true, message: '请输入账号' }]}>
            <Input
              autoComplete="username"
              placeholder="请输入账号"
              prefix={<AppIcon name="user" />}
              size="large"
            />
          </Form.Item>

          <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password
              autoComplete="current-password"
              placeholder="请输入密码"
              prefix={<AppIcon name="lock" />}
              size="large"
            />
          </Form.Item>

          <div className="login-form-meta">
            <Form.Item name="remember" valuePropName="checked" noStyle>
              <Checkbox>保持登录</Checkbox>
            </Form.Item>
          </div>

          <Button
            block
            htmlType="submit"
            icon={<AppIcon name="login" />}
            loading={submitting}
            size="large"
            type="primary"
          >
            登录
          </Button>
        </Form>
      </section>
    </main>
  )
}
