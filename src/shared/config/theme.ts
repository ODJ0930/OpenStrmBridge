import type { ThemeConfig } from 'antd'

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#1677ff',
    colorInfo: '#1677ff',
    colorSuccess: '#20a66a',
    colorWarning: '#e7a018',
    colorError: '#f05261',
    colorText: '#3f4b5b',
    colorTextSecondary: '#6b7785',
    colorBgLayout: '#f6f8fb',
    borderRadius: 6,
    borderRadiusLG: 8,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
    fontSize: 14,
    wireframe: false,
  },
  components: {
    Button: {
      borderRadius: 8,
      controlHeight: 38,
    },
    Card: {
      borderRadiusLG: 8,
    },
    Input: {
      borderRadius: 6,
    },
    Select: {
      borderRadius: 6,
    },
    Table: {
      cellPaddingBlock: 13,
      cellPaddingInline: 12,
      headerBg: '#f8fbff',
      headerColor: '#334155',
      rowHoverBg: '#f4fbff',
    },
    Tabs: {
      horizontalMargin: '0 28px 0 0',
      itemColor: '#66717f',
    },
  },
}
