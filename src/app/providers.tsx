import type { PropsWithChildren } from 'react'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'

import { themeConfig } from '../shared/config/theme'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  )
}
