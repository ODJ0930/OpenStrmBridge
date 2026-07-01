import { useEffect, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Segmented,
  Space,
  Switch,
  Table,
  Tag,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'

import type {
  StorageAccessMethod,
  StorageConnectionCheckResult,
  StorageDiscoveredEntry,
  StorageItem,
} from '../../shared/types/domain'
import { AppIcon } from '../../shared/ui/AppIcon'
import { ActionIconButton } from '../../shared/ui/ActionIconButton'
import { PagePanel } from '../../shared/ui/PagePanel'
import { StatCard } from '../../shared/ui/StatCard'
import { storageService } from './storageService'

interface StorageFormValues {
  name: string
  accessMethod: StorageAccessMethod
  endpoint: string
  rootPath: string
  token?: string
  username?: string
  password?: string
  basePath?: string
  strmBaseUrl?: string
  enableUrlEncoding?: boolean
  alist115Endpoint?: string
  alist115Token?: string
}

interface TokenCheckFormValues {
  token: string
}

const accessMethodMeta: Record<
  StorageAccessMethod,
  {
    label: string
    shortLabel: string
    color: string
    endpointLabel: string
    endpointPlaceholder: string
    rootLabel: string
    rootPlaceholder: string
  }
> = {
  openlist: {
    label: 'OpenList / Alist',
    shortLabel: 'OpenList',
    color: 'blue',
    endpointLabel: '服务地址',
    endpointPlaceholder: '请输入 OpenList / Alist 服务地址',
    rootLabel: '基础路径',
    rootPlaceholder: '留空表示根目录',
  },
  webdav: {
    label: 'WebDAV',
    shortLabel: 'WebDAV',
    color: 'green',
    endpointLabel: 'WebDAV 地址',
    endpointPlaceholder: '请输入 WebDAV 地址',
    rootLabel: '挂载根目录',
    rootPlaceholder: '留空表示使用 WebDAV 地址',
  },
  local: {
    label: '本地文件',
    shortLabel: '本地',
    color: 'default',
    endpointLabel: '本地路径',
    endpointPlaceholder: '请输入本地媒体目录路径',
    rootLabel: '扫描根目录',
    rootPlaceholder: '请输入本地媒体目录路径',
  },
}

const accessMethodOptions = (Object.keys(accessMethodMeta) as StorageAccessMethod[]).map(
  (method) => ({
    label: accessMethodMeta[method].label,
    value: method,
  }),
)

const defaultStorageValues: StorageFormValues = {
  name: '',
  accessMethod: 'openlist',
  endpoint: '',
  rootPath: '/',
  basePath: '',
  enableUrlEncoding: true,
}

function normalizePath(path: string | undefined, fallback = '/') {
  const normalized = path?.trim()
  return normalized ? normalized : fallback
}

function formatFileSize(size: number | undefined) {
  if (typeof size !== 'number') {
    return '-'
  }

  if (size < 1024) {
    return `${size} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function formatCheckedAt(checkedAt: string) {
  return new Date(checkedAt).toLocaleString('zh-CN', {
    hour12: false,
  })
}

function storageToFormValues(storage: StorageItem): StorageFormValues {
  return {
    name: storage.name,
    accessMethod: storage.accessMethod,
    endpoint: storage.endpoint,
    rootPath: storage.rootPath,
    token: storage.openlist?.token,
    username: storage.webdav?.username ?? storage.openlist?.username,
    password: storage.webdav?.password,
    basePath: storage.openlist?.basePath ?? storage.rootPath,
    strmBaseUrl: storage.openlist?.strmBaseUrl,
    enableUrlEncoding: storage.openlist?.enableUrlEncoding ?? true,
    alist115Endpoint: storage.alist115?.endpoint,
    alist115Token: storage.alist115?.token,
  }
}

function formValuesToStorage(
  values: StorageFormValues,
  existingStorage?: StorageItem | null,
): StorageItem {
  const accessMethod = values.accessMethod || 'openlist'
  const token = values.token?.trim()
  const password = values.password?.trim()
  const nextOpenListToken =
    accessMethod === 'openlist' ? token || existingStorage?.openlist?.token : undefined
  const nextWebDavPassword =
    accessMethod === 'webdav' ? password || existingStorage?.webdav?.password : undefined
  const alist115Token =
    accessMethod === 'openlist'
      ? values.alist115Token?.trim() || existingStorage?.alist115?.token || undefined
      : undefined
  const endpoint = accessMethod === 'local' ? values.rootPath.trim() : values.endpoint.trim()
  const rootPath =
    accessMethod === 'openlist'
      ? normalizePath(values.basePath, '/')
      : accessMethod === 'webdav'
        ? normalizePath(values.rootPath, '/')
        : endpoint

  return {
    id: existingStorage?.id ?? `storage-${Date.now()}`,
    name: values.name.trim(),
    accessMethod,
    endpoint,
    rootPath,
    status: existingStorage?.status ?? 'unchecked',
    quotaText: existingStorage?.quotaText,
    usagePercent: existingStorage?.usagePercent,
    credentialLabel:
      accessMethod === 'openlist'
        ? nextOpenListToken
          ? 'Token 已配置 / AList sign'
          : undefined
        : nextWebDavPassword
          ? '账号密码 / AList sign'
          : undefined,
    openlist:
      accessMethod === 'openlist'
        ? {
            username: values.username?.trim() || existingStorage?.openlist?.username,
            basePath: rootPath,
            strmBaseUrl: values.strmBaseUrl?.trim() || undefined,
            enableUrlEncoding: values.enableUrlEncoding !== false,
            token: nextOpenListToken,
          }
        : undefined,
    webdav:
      accessMethod === 'webdav'
        ? {
            username: values.username?.trim() || undefined,
            password: nextWebDavPassword,
          }
        : undefined,
    alist115:
      accessMethod === 'openlist' || accessMethod === 'webdav'
        ? {
            endpoint: values.alist115Endpoint?.trim() || undefined,
            token: alist115Token,
          }
        : undefined,
    local:
      accessMethod === 'local'
        ? {
            path: endpoint,
          }
        : undefined,
  }
}

function getStorageAddress(storage: StorageItem) {
  if (storage.accessMethod === 'local') {
    return storage.local?.path ?? storage.endpoint
  }

  return storage.endpoint
}

function applyConnectionResult(
  storage: StorageItem,
  result: StorageConnectionCheckResult,
  token?: string,
): StorageItem {
  const status = result.ok ? 'connected' : result.requiresBackend ? 'unchecked' : 'failed'

  if (storage.accessMethod !== 'openlist') {
    return {
      ...storage,
      lastCheck: result,
      status,
    }
  }

  const nextToken = token || storage.openlist?.token

  return {
    ...storage,
    credentialLabel: nextToken ? 'Token 已配置' : storage.credentialLabel,
    lastCheck: result,
    openlist: {
      basePath: result.rootPath,
      enableUrlEncoding: storage.openlist?.enableUrlEncoding ?? true,
      strmBaseUrl: storage.openlist?.strmBaseUrl,
      token: result.ok ? nextToken : storage.openlist?.token,
      username: result.username ?? storage.openlist?.username,
    },
    rootPath: result.rootPath,
    status,
  }
}

function renderStorageStatus(storage: StorageItem) {
  if (storage.status === 'connected') {
    return <span className="status-pill status-pill-success">已验证</span>
  }

  if (storage.status === 'failed') {
    return <span className="status-pill status-pill-danger">异常</span>
  }

  return <span className="status-pill status-pill-warning">未验证</span>
}

const discoveredEntryColumns: ColumnsType<StorageDiscoveredEntry> = [
  {
    title: '名称',
    dataIndex: 'name',
    width: 180,
    render: (_, entry) => (
      <span className="connection-entry-name">
        <AppIcon name={entry.kind === 'folder' ? 'folder' : 'file'} size={15} />
        {entry.name}
      </span>
    ),
  },
  {
    title: '路径',
    dataIndex: 'path',
    render: (path: string) => <span className="connection-entry-path">{path}</span>,
  },
  {
    title: '大小',
    dataIndex: 'size',
    width: 110,
    render: (size: number | undefined) => formatFileSize(size),
  },
  {
    title: '修改时间',
    dataIndex: 'updatedAt',
    width: 170,
    render: (updatedAt: string | undefined) => updatedAt ?? '-',
  },
]

export function StorageManagementPage() {
  const { message, modal } = AntApp.useApp()
  const [form] = Form.useForm<StorageFormValues>()
  const [tokenForm] = Form.useForm<TokenCheckFormValues>()
  const accessMethod = Form.useWatch('accessMethod', form) ?? 'openlist'
  const [storages, setStorages] = useState<StorageItem[]>([])
  const [storagesLoading, setStoragesLoading] = useState(true)
  const [editingStorage, setEditingStorage] = useState<StorageItem | null>(null)
  const [storageModalOpen, setStorageModalOpen] = useState(false)
  const [checkingStorageId, setCheckingStorageId] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<StorageConnectionCheckResult | null>(null)
  const [checkResultOpen, setCheckResultOpen] = useState(false)
  const [tokenModalOpen, setTokenModalOpen] = useState(false)
  const [tokenCheckStorage, setTokenCheckStorage] = useState<StorageItem | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadStorages() {
      setStoragesLoading(true)

      try {
        const loadedStorages = await storageService.list()

        if (mounted) {
          setStorages(loadedStorages)
        }
      } catch {
        if (mounted) {
          message.error('读取存储记录失败')
        }
      } finally {
        if (mounted) {
          setStoragesLoading(false)
        }
      }
    }

    void loadStorages()

    return () => {
      mounted = false
    }
  }, [message])

  useEffect(() => {
    if (!storageModalOpen) {
      return
    }

    form.resetFields()
    form.setFieldsValue(editingStorage ? storageToFormValues(editingStorage) : defaultStorageValues)
  }, [editingStorage, form, storageModalOpen])

  function openCreateModal() {
    setEditingStorage(null)
    form.setFieldsValue(defaultStorageValues)
    setStorageModalOpen(true)
  }

  function openEditModal(storage: StorageItem) {
    setEditingStorage(storage)
    form.setFieldsValue(storageToFormValues(storage))
    setStorageModalOpen(true)
  }

  function handleMethodChange(method: StorageAccessMethod) {
    if (method === 'openlist') {
      form.setFieldsValue({
        accessMethod: method,
        endpoint: '',
        rootPath: '/',
        basePath: '',
        enableUrlEncoding: true,
      })
      return
    }

    if (method === 'webdav') {
      form.setFieldsValue({
        accessMethod: method,
        endpoint: '',
        rootPath: '',
      })
      return
    }

    form.setFieldsValue({
      accessMethod: method,
      endpoint: '',
      rootPath: '',
    })
  }

  async function runConnectionCheck(storage: StorageItem, tokenOverride?: string) {
    const token = tokenOverride?.trim()

    setCheckingStorageId(storage.id)

    try {
      const result = await storageService.checkConnection(storage, token ? { token } : undefined)
      const checkedStorage = applyConnectionResult(storage, result, token)

      setCheckResult(result)
      setCheckResultOpen(true)
      setStorages((current) =>
        current.map((item) =>
          item.id === storage.id ? applyConnectionResult(item, result, token) : item,
        ),
      )

      void storageService.save(checkedStorage).catch(() => {
        message.warning('检查结果未能写入后端存储记录')
      })

      if (result.ok) {
        message.success(`${storage.name} 连通性检查成功`)
      } else if (result.requiresBackend) {
        message.info(`${storage.name} 需要后端执行连通性检查`)
      } else {
        message.error(`${storage.name} 连通性检查失败`)
      }
    } finally {
      setCheckingStorageId(null)

      if (token) {
        setTokenModalOpen(false)
        setTokenCheckStorage(null)
        tokenForm.resetFields()
      }
    }
  }

  function handleConnectivity(storage: StorageItem) {
    if (storage.accessMethod === 'openlist' && !storage.openlist?.token) {
      setTokenCheckStorage(storage)
      tokenForm.resetFields()
      setTokenModalOpen(true)
      return
    }

    void runConnectionCheck(storage)
  }

  function handleTokenCheck(values: TokenCheckFormValues) {
    if (!tokenCheckStorage) {
      return
    }

    void runConnectionCheck(tokenCheckStorage, values.token)
  }

  function handleDelete(storage: StorageItem) {
    modal.confirm({
      title: `删除存储 ${storage.name}`,
      content: '当前前端会从列表中移除该存储；接入后端后会改为调用删除接口。',
      okButtonProps: { danger: true },
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        try {
          await storageService.remove(storage.id)
          setStorages((current) => current.filter((item) => item.id !== storage.id))
          message.success('存储已删除')
        } catch {
          message.error('删除存储失败')
          throw new Error('删除存储失败')
        }
      },
    })
  }

  async function handleSaveStorage(values: StorageFormValues) {
    if (values.accessMethod === 'openlist') {
      const hasReusableOpenListToken = Boolean(
        values.token?.trim() || editingStorage?.openlist?.token,
      )
      const hasAListToken = Boolean(values.alist115Token?.trim() || editingStorage?.alist115?.token)

      if (!hasReusableOpenListToken && !hasAListToken) {
        message.error('生成 STRM 时会默认追加 AList sign，请填写可调用 /api/fs/get 的 AList Token')
        return
      }
    }

    const savedStorage = formValuesToStorage(values, editingStorage)

    try {
      const persistedStorage = await storageService.save(savedStorage)

      if (editingStorage) {
        setStorages((current) =>
          current.map((storage) => (storage.id === editingStorage.id ? persistedStorage : storage)),
        )
        message.success('存储已保存')
      } else {
        setStorages((current) => [persistedStorage, ...current])
        message.success('存储已添加')
      }

      setStorageModalOpen(false)
    } catch {
      message.error('保存存储失败，请确认后端服务已启动')
    }
  }

  const columns: ColumnsType<StorageItem> = [
    {
      title: '存储名',
      dataIndex: 'name',
      width: 170,
      fixed: 'left',
      render: (name: string) => <strong className="storage-name-cell">{name}</strong>,
    },
    {
      title: '接入方式',
      dataIndex: 'accessMethod',
      width: 180,
      render: (_, storage) => {
        const meta = accessMethodMeta[storage.accessMethod]
        return (
          <Space size={6} wrap>
            <Tag color={meta.color}>{meta.label}</Tag>
          </Space>
        )
      },
    },
    {
      title: '地址 / 路径',
      dataIndex: 'endpoint',
      render: (_, storage) => (
        <div className="storage-address-cell">
          <span>{getStorageAddress(storage)}</span>
          {storage.credentialLabel ? <Tag>{storage.credentialLabel}</Tag> : null}
          {storage.accessMethod === 'openlist' || storage.accessMethod === 'webdav' ? (
            <Tag color="cyan">AList sign</Tag>
          ) : null}
          {storage.badge ? <Tag>{storage.badge}</Tag> : null}
          {typeof storage.usagePercent === 'number' ? (
            <div className="quota-bar">
              <Progress percent={storage.usagePercent} showInfo={false} size="small" />
              <span>{storage.quotaText}</span>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (_, storage) => renderStorageStatus(storage),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_, storage) => (
        <Space size={6}>
          <ActionIconButton icon="edit" label="编辑存储" onClick={() => openEditModal(storage)} />
          <ActionIconButton
            icon="link"
            label="连通性检查"
            tone="success"
            disabled={checkingStorageId === storage.id}
            onClick={() => handleConnectivity(storage)}
          />
          <ActionIconButton
            icon="delete"
            label="删除存储"
            tone="danger"
            onClick={() => handleDelete(storage)}
          />
        </Space>
      ),
    },
  ]

  const currentMeta = accessMethodMeta[accessMethod]
  const secretRequired =
    accessMethod === 'openlist'
      ? !editingStorage?.openlist?.token
      : accessMethod === 'webdav'
        ? !editingStorage?.webdav?.password
        : false
  const storageFormInitialValues = editingStorage
    ? storageToFormValues(editingStorage)
    : defaultStorageValues
  const connectedCount = storages.filter((storage) => storage.status === 'connected').length
  const failedCount = storages.filter((storage) => storage.status === 'failed').length
  const uncheckedCount = storages.filter((storage) => storage.status === 'unchecked').length
  const openlistCount = storages.filter((storage) => storage.accessMethod === 'openlist').length
  const webdavCount = storages.filter((storage) => storage.accessMethod === 'webdav').length
  const localCount = storages.filter((storage) => storage.accessMethod === 'local').length

  return (
    <PagePanel
      actions={
        <Button icon={<AppIcon name="plus" />} type="primary" onClick={openCreateModal}>
          添加存储
        </Button>
      }
      eyebrow="Storage"
      subtitle="维护媒体来源、凭据状态和连通性检查结果。"
      title="存储管理"
    >
      <div className="summary-grid">
        <StatCard
          detail={`${openlistCount} OpenList / ${webdavCount} WebDAV / ${localCount} 本地`}
          icon="database"
          title="存储总数"
          value={storages.length}
        />
        <StatCard
          detail={connectedCount > 0 ? '可直接用于任务扫描' : '等待连通性验证'}
          icon="check"
          title="已验证"
          tone="green"
          value={connectedCount}
        />
        <StatCard
          detail={uncheckedCount > 0 ? '建议执行连通性检查' : '全部已处理'}
          icon="gauge"
          title="未验证"
          tone="amber"
          value={uncheckedCount}
        />
        <StatCard
          detail={failedCount > 0 ? '需要重新检查配置' : '当前没有异常'}
          icon={failedCount > 0 ? 'alert' : 'sparkles'}
          title="异常"
          tone={failedCount > 0 ? 'rose' : 'cyan'}
          value={failedCount}
        />
      </div>

      <div className="table-card">
        <Table
          className="storage-table"
          columns={columns}
          dataSource={storages}
          locale={{ emptyText: '暂无存储，请点击添加存储并填写自己的地址或路径' }}
          loading={storagesLoading}
          pagination={false}
          rowKey="id"
          scroll={{ x: 980 }}
          size="middle"
        />
      </div>

      <Modal
        destroyOnHidden
        okText="保存"
        open={storageModalOpen}
        title={editingStorage ? '编辑存储' : '添加存储'}
        width={720}
        onCancel={() => setStorageModalOpen(false)}
        onOk={() => form.submit()}
      >
        <Form
          form={form}
          initialValues={storageFormInitialValues}
          key={editingStorage?.id ?? 'new-storage'}
          layout="vertical"
          preserve={false}
          onFinish={handleSaveStorage}
        >
          <Form.Item label="接入方式" name="accessMethod">
            <Segmented
              block
              options={accessMethodOptions}
              value={accessMethod}
              onChange={(value) => handleMethodChange(value as StorageAccessMethod)}
            />
          </Form.Item>

          <Form.Item
            label="存储名"
            name="name"
            rules={[{ required: true, message: '请输入存储名' }]}
          >
            <Input placeholder="电影" />
          </Form.Item>

          <Form.Item
            label={currentMeta.endpointLabel}
            name={accessMethod === 'local' ? 'rootPath' : 'endpoint'}
            rules={[{ required: true, message: `请输入${currentMeta.endpointLabel}` }]}
          >
            <Input placeholder={currentMeta.endpointPlaceholder} />
          </Form.Item>

          {accessMethod === 'openlist' ? (
            <>
              <Form.Item
                extra={editingStorage ? '已回填保存的 Token，清空表示不修改。' : undefined}
                label="Token"
                name="token"
                rules={[{ required: secretRequired, message: '请输入 OpenList / Alist Token' }]}
              >
                <Input.Password placeholder="alist-..." />
              </Form.Item>
              <Form.Item label={currentMeta.rootLabel} name="basePath">
                <Input placeholder={currentMeta.rootPlaceholder} />
              </Form.Item>
              <Form.Item label="OpenList 用户名" name="username">
                <Input placeholder="验证后由后端写入，也可手动标记" />
              </Form.Item>
              <Form.Item label="STRM Base URL" name="strmBaseUrl">
                <Input placeholder="留空则使用原始 OpenList / Alist 地址" />
              </Form.Item>
              <Form.Item label="URL 编码" name="enableUrlEncoding" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="关闭" />
              </Form.Item>
            </>
          ) : null}

          {accessMethod === 'webdav' ? (
            <>
              <Form.Item label={currentMeta.rootLabel} name="rootPath">
                <Input placeholder={currentMeta.rootPlaceholder} />
              </Form.Item>
              <Form.Item
                label="用户名"
                name="username"
                rules={[{ required: true, message: '请输入 WebDAV 用户名' }]}
              >
                <Input placeholder="WebDAV 用户名" />
              </Form.Item>
              <Form.Item
                extra={editingStorage ? '已回填保存的密码，清空表示不修改。' : undefined}
                label="密码"
                name="password"
                rules={[{ required: secretRequired, message: '请输入 WebDAV 密码' }]}
              >
                <Input.Password placeholder="WebDAV 密码" />
              </Form.Item>
            </>
          ) : null}

          {accessMethod === 'openlist' || accessMethod === 'webdav' ? (
            <section className="storage-sign-section">
              <Alert
                description="生成 STRM 时会调用 AList /api/fs/get 获取文件 sign，并追加到 /d 直链后。OpenList / Alist 会优先复用上方 Token，WebDAV 会使用上方用户名和密码登录 AList 获取 token。"
                message="AList sign 默认启用"
                showIcon
                type="info"
              />
              <Form.Item
                extra={
                  accessMethod === 'openlist'
                    ? '留空则使用上方 OpenList / Alist 服务地址。'
                    : 'WebDAV 一般会自动从 /dav 地址推断；推断不准时请填写 AList 管理地址，例如 http://host:5244。'
                }
                label="AList 管理地址"
                name="alist115Endpoint"
              >
                <Input placeholder="http://47.86.231.104:5244" />
              </Form.Item>
              {accessMethod === 'openlist' ? (
                <Form.Item
                  extra="可选；留空时复用上方 OpenList / Alist Token。"
                  label="AList Token"
                  name="alist115Token"
                >
                  <Input.Password placeholder="alist-..." />
                </Form.Item>
              ) : null}
            </section>
          ) : null}
        </Form>
      </Modal>

      <Modal
        destroyOnHidden
        confirmLoading={checkingStorageId === tokenCheckStorage?.id}
        okText="开始检查"
        open={tokenModalOpen}
        title={`输入 ${tokenCheckStorage?.name ?? 'OpenList / Alist'} Token`}
        onCancel={() => {
          setTokenModalOpen(false)
          setTokenCheckStorage(null)
        }}
        onOk={() => tokenForm.submit()}
      >
        <Form form={tokenForm} layout="vertical" preserve={false} onFinish={handleTokenCheck}>
          <Form.Item
            extra="Token 只保存在当前前端运行状态中，用于这次真实连通性检查，不会写入仓库。"
            label="OpenList / Alist Token"
            name="token"
            rules={[{ required: true, message: '请输入 Token 后再检查' }]}
          >
            <Input.Password autoFocus placeholder="alist-..." />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        footer={
          <Button type="primary" onClick={() => setCheckResultOpen(false)}>
            关闭
          </Button>
        }
        open={checkResultOpen}
        title="连通性检查结果"
        width={860}
        onCancel={() => setCheckResultOpen(false)}
      >
        {checkResult ? (
          <div className="connection-result">
            <Alert
              showIcon
              description={checkResult.message}
              message={checkResult.title}
              type={checkResult.ok ? 'success' : checkResult.requiresBackend ? 'info' : 'error'}
            />

            <Descriptions
              bordered
              className="connection-result-meta"
              column={1}
              items={[
                { key: 'endpoint', label: '地址', children: checkResult.endpoint || '-' },
                { key: 'rootPath', label: '根路径', children: checkResult.rootPath || '-' },
                {
                  key: 'checkedAt',
                  label: '检查时间',
                  children: formatCheckedAt(checkResult.checkedAt),
                },
                ...(checkResult.username
                  ? [{ key: 'username', label: '账号', children: checkResult.username }]
                  : []),
                ...(checkResult.basePath
                  ? [{ key: 'basePath', label: '账号基础路径', children: checkResult.basePath }]
                  : []),
              ]}
              size="small"
            />

            <section className="connection-result-section">
              <h3>获取到的文件夹</h3>
              {checkResult.folders.length > 0 ? (
                <Table
                  columns={discoveredEntryColumns}
                  dataSource={checkResult.folders}
                  pagination={false}
                  rowKey="id"
                  scroll={{ x: 700 }}
                  size="small"
                />
              ) : (
                <Empty description="没有返回文件夹" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </section>

            {checkResult.files.length > 0 ? (
              <section className="connection-result-section">
                <h3>文件样本</h3>
                <Table
                  columns={discoveredEntryColumns}
                  dataSource={checkResult.files}
                  pagination={false}
                  rowKey="id"
                  scroll={{ x: 700 }}
                  size="small"
                />
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </PagePanel>
  )
}
