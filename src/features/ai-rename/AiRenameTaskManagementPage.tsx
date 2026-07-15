import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  App as AntApp,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'

import type {
  AiRenameJob,
  AiRenameManagedTask,
  AiRenameManagedTaskInput,
  FileEntry,
  StorageItem,
} from '../../shared/types/domain'
import { getParentPath, isRootPath } from '../../shared/lib/path'
import { ActionIconButton } from '../../shared/ui/ActionIconButton'
import { AppIcon } from '../../shared/ui/AppIcon'
import { PagePanel } from '../../shared/ui/PagePanel'
import { StatCard } from '../../shared/ui/StatCard'
import { fileBrowserService } from '../file-browser/fileBrowserService'
import { aiRenameTaskService } from './aiRenameTaskService'

const runningStatuses = new Set(['queued', 'running'])

function defaultStoragePath(storage: StorageItem | undefined) {
  if (!storage) return '/'
  if (storage.accessMethod === 'local') {
    return storage.local?.path || storage.rootPath || storage.endpoint || '/'
  }
  if (storage.accessMethod === 'openlist') {
    return storage.openlist?.basePath || storage.rootPath || '/'
  }
  return storage.rootPath || '/'
}

function statusTag(status: AiRenameManagedTask['status']) {
  const color =
    status === 'completed'
      ? 'green'
      : status === 'partial'
        ? 'orange'
        : status === 'failed'
          ? 'red'
          : runningStatuses.has(status)
            ? 'processing'
            : 'default'
  const labels: Record<string, string> = {
    cancelled: '已取消',
    completed: '已完成',
    failed: '失败',
    idle: '空闲',
    partial: '部分成功',
    queued: '排队中',
    running: '运行中',
  }
  return <Tag color={color}>{labels[status] || status}</Tag>
}

function jobProgress(job: AiRenameJob) {
  if (['completed', 'partial', 'failed', 'cancelled'].includes(job.status)) return 100

  const totalGroups = job.progress.totalGroups ?? 0
  const processedGroups = job.progress.processedGroups ?? 0

  if (totalGroups > 0) {
    const activeGroupFraction = processedGroups < totalGroups && job.currentPath ? 0.5 : 0
    return Math.min(99, Math.round(((processedGroups + activeGroupFraction) / totalGroups) * 100))
  }

  if (job.progress.totalOperations <= 0) return 0
  return Math.min(
    100,
    Math.round((job.progress.completedOperations / job.progress.totalOperations) * 100),
  )
}

const stageLabels: Record<AiRenameJob['stage'], string> = {
  analyzing: 'AI 分析',
  cancelled: '已取消',
  executing: '逐项改名',
  failed: '失败',
  finished: '已完成',
  moving: '整理目录',
  queued: '排队中',
  scanning: '扫描目录',
}

const resultStatusLabels: Record<AiRenameJob['results'][number]['status'], string> = {
  failed: '失败',
  ignored: '忽略',
  info: '目录',
  skipped: '跳过',
  succeeded: '成功',
  warning: '提示',
}

function formatJobLogTime(value: string | undefined) {
  if (!value) return '--:--:--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('zh-CN', { hour12: false })
}

function createJobLogContent(job: AiRenameJob) {
  const lines = [
    `[${formatJobLogTime(job.startedAt || job.createdAt)}] [任务] 开始处理 ${job.path}`,
    `[当前阶段] ${stageLabels[job.stage]} · ${job.message}`,
  ]

  if (job.currentPath) {
    lines.push(`[当前目录] ${job.currentPath}`)
  }

  lines.push('')

  for (const item of job.results) {
    lines.push(
      `[${formatJobLogTime(item.at)}] [${resultStatusLabels[item.status]}] ${item.message}`,
    )
    if (item.oldPath) lines.push(`  源/目录：${item.oldPath}`)
    if (item.newPath) lines.push(`  目标：${item.newPath}`)
  }

  if (job.finishedAt) {
    lines.push('', `[${formatJobLogTime(job.finishedAt)}] [任务] ${job.message}`)
  }

  return lines.join('\n')
}

function renderJobLogContent(job: AiRenameJob) {
  return createJobLogContent(job)
    .split('\n')
    .map((line, index, lines) => {
      const className = /\[失败\]/.test(line)
        ? 'task-log-line task-log-line-danger'
        : /\[成功\]|目录处理完成/.test(line)
          ? 'task-log-line task-log-line-success'
          : 'task-log-line'

      return (
        <span className={className} key={`${index}-${line}`}>
          {line}
          {index < lines.length - 1 ? '\n' : null}
        </span>
      )
    })
}

export function AiRenameTaskManagementPage() {
  const { message, modal } = AntApp.useApp()
  const [tasks, setTasks] = useState<AiRenameManagedTask[]>([])
  const [storages, setStorages] = useState<StorageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [runningAll, setRunningAll] = useState(false)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [resultModalOpen, setResultModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<AiRenameManagedTask | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [selectedJob, setSelectedJob] = useState<AiRenameJob | null>(null)
  const [pathPickerOpen, setPathPickerOpen] = useState(false)
  const [pathPickerPath, setPathPickerPath] = useState('/')
  const [pathPickerSelectedPath, setPathPickerSelectedPath] = useState('')
  const [pathPickerEntries, setPathPickerEntries] = useState<FileEntry[]>([])
  const [pathPickerLoading, setPathPickerLoading] = useState(false)
  const logViewerRef = useRef<HTMLPreElement>(null)
  const [form] = Form.useForm<AiRenameManagedTaskInput>()
  const watchedStorageId = Form.useWatch('storageId', form) ?? ''

  const loadTasks = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      try {
        setTasks(await aiRenameTaskService.list())
      } catch (error) {
        message.error(error instanceof Error ? error.message : '读取 AI 重命名任务失败')
      } finally {
        if (!quiet) setLoading(false)
      }
    },
    [message],
  )

  useEffect(() => {
    void loadTasks()
    fileBrowserService
      .listStorages()
      .then(setStorages)
      .catch((error) => message.error(error instanceof Error ? error.message : '读取存储失败'))
  }, [loadTasks, message])

  useEffect(() => {
    if (!tasks.some((task) => runningStatuses.has(task.status))) return
    const timer = window.setInterval(() => void loadTasks(true), 1200)
    return () => window.clearInterval(timer)
  }, [loadTasks, tasks])

  useEffect(() => {
    if (
      !resultModalOpen ||
      !selectedTaskId ||
      !selectedJob ||
      !runningStatuses.has(selectedJob.status)
    ) {
      return
    }

    const timer = window.setInterval(() => {
      void aiRenameTaskService
        .getResult(selectedTaskId)
        .then(setSelectedJob)
        .catch(() => undefined)
    }, 1200)
    return () => window.clearInterval(timer)
  }, [resultModalOpen, selectedJob, selectedTaskId])

  useEffect(() => {
    if (!resultModalOpen || !logViewerRef.current) return
    logViewerRef.current.scrollTop = logViewerRef.current.scrollHeight
  }, [resultModalOpen, selectedJob?.currentPath, selectedJob?.results.length])

  const storageMap = useMemo(
    () => new Map(storages.map((storage) => [storage.id, storage.name])),
    [storages],
  )
  const selectedStorage = useMemo(
    () => storages.find((storage) => storage.id === watchedStorageId),
    [storages, watchedStorageId],
  )
  const runningCount = tasks.filter((task) => runningStatuses.has(task.status)).length
  const successCount = tasks.filter((task) => task.status === 'completed').length
  const failedCount = tasks.filter((task) => ['failed', 'partial'].includes(task.status)).length

  function openCreateModal() {
    const storage = storages[0]
    const path = defaultStoragePath(storage)
    setEditingTask(null)
    form.setFieldsValue({
      allowMove: false,
      extraPrompt: '',
      id: `ai-rename-${Date.now()}`,
      name: '',
      path,
      storageId: storage?.id ?? '',
      useTmdb: false,
    })
    setPathPickerEntries([])
    setPathPickerPath(path)
    setPathPickerSelectedPath('')
    setTaskModalOpen(true)
  }

  function openEditModal(task: AiRenameManagedTask) {
    setEditingTask(task)
    form.setFieldsValue({
      allowMove: task.allowMove,
      extraPrompt: task.extraPrompt ?? '',
      id: task.id,
      name: task.name,
      path: task.path,
      storageId: task.storageId,
      useTmdb: task.useTmdb,
    })
    setPathPickerEntries([])
    setPathPickerPath(task.path)
    setPathPickerSelectedPath('')
    setTaskModalOpen(true)
  }

  function handleStorageChange(storageId: string) {
    const storage = storages.find((item) => item.id === storageId)
    const path = defaultStoragePath(storage)

    form.setFieldsValue({ path, storageId })
    setPathPickerEntries([])
    setPathPickerPath(path)
    setPathPickerSelectedPath('')
  }

  async function loadPathPickerEntries(storageId: string, nextPath: string) {
    setPathPickerLoading(true)

    try {
      const result = await fileBrowserService.listEntries(storageId, nextPath)
      setPathPickerPath(result.path)
      setPathPickerSelectedPath('')
      setPathPickerEntries(result.entries.filter((entry) => entry.kind === 'folder'))
    } catch (error) {
      setPathPickerEntries([])
      message.error(error instanceof Error ? error.message : '读取存储目录失败')
    } finally {
      setPathPickerLoading(false)
    }
  }

  function handleOpenPathPicker() {
    const storageId = form.getFieldValue('storageId')
    const storage = storages.find((item) => item.id === storageId)

    if (!storageId || !storage) {
      message.info('请先选择存储')
      return
    }

    const currentPath = form.getFieldValue('path')?.trim() || defaultStoragePath(storage)
    setPathPickerOpen(true)
    setPathPickerPath(currentPath)
    setPathPickerSelectedPath('')
    setPathPickerEntries([])
    void loadPathPickerEntries(storageId, currentPath)
  }

  function handlePathPickerParent() {
    if (!watchedStorageId || isRootPath(pathPickerPath)) return
    void loadPathPickerEntries(watchedStorageId, getParentPath(pathPickerPath))
  }

  function handlePathPickerRefresh() {
    if (!watchedStorageId) return
    void loadPathPickerEntries(watchedStorageId, pathPickerPath)
  }

  function handleUsePathPickerPath() {
    form.setFieldValue('path', pathPickerSelectedPath || pathPickerPath)
    setPathPickerOpen(false)
  }

  async function saveTask(values: AiRenameManagedTaskInput) {
    setSaving(true)
    try {
      await aiRenameTaskService.save({ ...values, id: editingTask?.id ?? values.id })
      message.success(editingTask ? 'AI 重命名任务已更新' : 'AI 重命名任务已添加')
      setTaskModalOpen(false)
      await loadTasks()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存任务失败')
    } finally {
      setSaving(false)
    }
  }

  async function runTask(task: AiRenameManagedTask) {
    try {
      const response = await aiRenameTaskService.run(task.id)
      setSelectedTaskId(task.id)
      setSelectedJob(response.job)
      setResultModalOpen(true)
      message.success(`${task.name} 已启动`)
      await loadTasks()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '运行任务失败')
    }
  }

  async function stopTask(task: AiRenameManagedTask) {
    try {
      await aiRenameTaskService.stop(task.id)
      message.info(`正在停止 ${task.name}`)
      await loadTasks()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '停止任务失败')
    }
  }

  async function runAll() {
    setRunningAll(true)
    try {
      const result = await aiRenameTaskService.runAll()
      const errors = result.results.filter((item) => 'error' in item).length
      if (errors > 0) {
        message.warning(`${errors} 个任务未能启动`)
      } else {
        message.success('全部任务已启动')
      }
      setTasks(result.tasks)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '运行全部任务失败')
    } finally {
      setRunningAll(false)
    }
  }

  function removeTask(task: AiRenameManagedTask) {
    modal.confirm({
      content: '仅删除任务配置，不会删除或回滚已经重命名的文件。',
      okButtonProps: { danger: true },
      okText: '删除',
      title: `删除任务 ${task.name}`,
      onOk: async () => {
        await aiRenameTaskService.remove(task.id)
        message.success('AI 重命名任务已删除')
        await loadTasks()
      },
    })
  }

  async function openResult(task: AiRenameManagedTask) {
    try {
      setSelectedTaskId(task.id)
      setSelectedJob(await aiRenameTaskService.getResult(task.id))
      setResultModalOpen(true)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取任务结果失败')
    }
  }

  const columns: ColumnsType<AiRenameManagedTask> = [
    { dataIndex: 'name', title: '任务名称', width: 180 },
    {
      title: '目标目录',
      render: (_, task) => (
        <div>
          <strong>{storageMap.get(task.storageId) || task.storageId}</strong>
          <div className="task-path-cell">{task.path}</div>
        </div>
      ),
    },
    {
      title: '选项',
      width: 180,
      render: (_, task) => (
        <Space size={[4, 4]} wrap>
          {task.allowMove ? <Tag color="blue">重建目录</Tag> : <Tag>仅改名</Tag>}
          {task.useTmdb ? <Tag color="purple">TMDB</Tag> : null}
        </Space>
      ),
    },
    { title: '状态', width: 110, render: (_, task) => statusTag(task.status) },
    {
      dataIndex: 'lastRunAt',
      title: '最近运行',
      width: 180,
      render: (value: string | undefined) =>
        value ? new Date(value).toLocaleString('zh-CN') : '-',
    },
    {
      fixed: 'right',
      title: '操作',
      width: 250,
      render: (_, task) => (
        <Space size="small">
          {runningStatuses.has(task.status) ? (
            <Button danger size="small" onClick={() => void stopTask(task)}>
              停止
            </Button>
          ) : (
            <Button size="small" type="primary" onClick={() => void runTask(task)}>
              运行
            </Button>
          )}
          <ActionIconButton
            icon="logs"
            label="查看运行日志"
            tone="cyan"
            onClick={() => void openResult(task)}
          />
          <Button
            disabled={runningStatuses.has(task.status)}
            size="small"
            onClick={() => openEditModal(task)}
          >
            编辑
          </Button>
          <Button
            danger
            disabled={runningStatuses.has(task.status)}
            size="small"
            onClick={() => removeTask(task)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ]

  const pathPickerColumns: ColumnsType<FileEntry> = [
    {
      dataIndex: 'name',
      title: '文件夹',
      render: (_, entry) => (
        <span className="file-name-cell file-name-cell--folder">
          <AppIcon name="folder" />
          {entry.name}
        </span>
      ),
    },
    { dataIndex: 'path', ellipsis: true, title: '路径' },
  ]

  return (
    <PagePanel
      actions={
        <Space>
          <Button disabled={tasks.length === 0} loading={runningAll} onClick={() => void runAll()}>
            运行所有
          </Button>
          <Button icon={<AppIcon name="plus" />} type="primary" onClick={openCreateModal}>
            添加任务
          </Button>
        </Space>
      }
      eyebrow="AI Rename Tasks"
      subtitle="先汇总整库目录清单并一次提交 AI 识别，再由程序按顺序逐项修改；支持增删改、运行、停止和日志查看。"
      title="AI 重命名任务管理"
    >
      <div className="summary-grid">
        <StatCard detail="已保存配置" icon="tasks" title="任务总数" value={tasks.length} />
        <StatCard
          detail="当前执行"
          icon="activity"
          title="运行中"
          tone="amber"
          value={runningCount}
        />
        <StatCard detail="最近结果" icon="check" title="已完成" tone="green" value={successCount} />
        <StatCard
          detail="失败或部分成功"
          icon="alert"
          title="需检查"
          tone="violet"
          value={failedCount}
        />
      </div>
      <div className="table-card">
        <Table
          columns={columns}
          dataSource={tasks}
          loading={loading}
          locale={{ emptyText: '暂无 AI 重命名任务，请点击添加任务' }}
          pagination={false}
          rowKey="id"
          scroll={{ x: 1050 }}
        />
      </div>

      <Modal
        confirmLoading={saving}
        okText="保存任务"
        open={taskModalOpen}
        title={editingTask ? '编辑 AI 重命名任务' : '添加 AI 重命名任务'}
        onCancel={() => setTaskModalOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(values) => void saveTask(values)}>
          <Form.Item hidden name="id">
            <Input />
          </Form.Item>
          <Form.Item
            label="任务名称"
            name="name"
            rules={[{ required: true, message: '请输入任务名称' }]}
          >
            <Input placeholder="例如：整理光鸭电视剧" />
          </Form.Item>
          <Form.Item
            label="存储"
            name="storageId"
            rules={[{ required: true, message: '请选择存储' }]}
          >
            <Select
              options={storages.map((storage) => ({ label: storage.name, value: storage.id }))}
              onChange={handleStorageChange}
            />
          </Form.Item>
          <Form.Item
            extra="单击选择文件夹；在目录选择器中双击文件夹可继续进入下一级。"
            label="目标目录"
            name="path"
            rules={[{ required: true, message: '请选择目标目录' }]}
          >
            <Input
              readOnly
              placeholder="点击选择目标目录"
              prefix={<AppIcon name="folder" />}
              suffix={
                <Button size="small" type="text" onClick={handleOpenPathPicker}>
                  选择
                </Button>
              }
              onClick={handleOpenPathPicker}
            />
          </Form.Item>
          <Form.Item
            extra="开启后输出：剧集名 (年份)/Season 01/剧集名 - S01E01.ext"
            name="allowMove"
            valuePropName="checked"
          >
            <Checkbox>重建并合并 Emby 标准文件夹结构</Checkbox>
          </Form.Item>
          <Form.Item name="useTmdb" valuePropName="checked">
            <Checkbox>使用 TMDB 校验</Checkbox>
          </Form.Item>
          <Form.Item label="任务补充说明（可选）" name="extraPrompt">
            <Input.TextArea maxLength={2000} rows={3} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        footer={
          <Space>
            <Button onClick={() => setPathPickerOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleUsePathPickerPath}>
              {pathPickerSelectedPath ? '选择此文件夹' : '使用当前目录'}
            </Button>
          </Space>
        }
        open={pathPickerOpen}
        title={`选择目标目录${selectedStorage ? ` - ${selectedStorage.name}` : ''}`}
        width={820}
        onCancel={() => setPathPickerOpen(false)}
      >
        <div className="task-path-picker-toolbar">
          <Button
            disabled={isRootPath(pathPickerPath)}
            icon={<AppIcon name="arrowUp" />}
            onClick={handlePathPickerParent}
          >
            返回上级
          </Button>
          <Input readOnly aria-label="当前目录" value={pathPickerPath} />
          <Button icon={<AppIcon name="refresh" />} onClick={handlePathPickerRefresh}>
            刷新
          </Button>
        </div>

        <Table
          columns={pathPickerColumns}
          dataSource={pathPickerEntries}
          loading={pathPickerLoading}
          locale={{ emptyText: '当前目录没有下级文件夹，可以直接使用当前目录' }}
          pagination={false}
          rowClassName={(entry) =>
            entry.path === pathPickerSelectedPath
              ? 'file-browser-row--folder task-path-picker-row-selected'
              : 'file-browser-row--folder'
          }
          rowKey="id"
          scroll={{ x: 720, y: 360 }}
          size="small"
          onRow={(entry) => ({
            onClick: () => setPathPickerSelectedPath(entry.path),
            onDoubleClick: () => void loadPathPickerEntries(watchedStorageId, entry.path),
          })}
        />
      </Modal>

      <Modal
        footer={
          <Button
            type="primary"
            onClick={() => {
              setResultModalOpen(false)
              setSelectedTaskId('')
            }}
          >
            关闭
          </Button>
        }
        open={resultModalOpen}
        title="AI 重命名运行日志与结果"
        width={900}
        onCancel={() => {
          setResultModalOpen(false)
          setSelectedTaskId('')
        }}
      >
        {selectedJob ? (
          <div className="ai-rename-job-panel">
            <div className="ai-rename-live-state">
              <Space wrap>
                {statusTag(selectedJob.status)}
                <Tag color="blue">{stageLabels[selectedJob.stage]}</Tag>
                <strong>{selectedJob.message}</strong>
              </Space>
              <div className="ai-rename-current-path">
                <span>
                  <AppIcon name="folder" /> 当前处理源路径（最终路径见日志“目标”）
                </span>
                <code>
                  {selectedJob.currentPath ||
                    (selectedJob.finishedAt
                      ? '任务已结束，请在下方日志查看处理记录'
                      : selectedJob.path)}
                </code>
              </div>
            </div>
            <Progress percent={jobProgress(selectedJob)} />
            <div className="ai-rename-progress-grid">
              <span>
                目录
                <strong>
                  {selectedJob.progress.processedGroups ?? 0}/
                  {selectedJob.progress.totalGroups ?? '-'}
                </strong>
              </span>
              <span>
                扫描<strong>{selectedJob.progress.scanned}</strong>
              </span>
              <span>
                分析<strong>{selectedJob.progress.analyzed}</strong>
              </span>
              <span>
                成功<strong>{selectedJob.progress.succeeded}</strong>
              </span>
              <span>
                跳过<strong>{selectedJob.progress.skipped}</strong>
              </span>
              <span>
                失败<strong>{selectedJob.progress.failed}</strong>
              </span>
            </div>
            <pre className="task-log-viewer ai-rename-log-viewer" ref={logViewerRef}>
              {renderJobLogContent(selectedJob)}
            </pre>
          </div>
        ) : (
          <div className="ai-rename-job-empty">该任务尚无运行结果</div>
        )}
      </Modal>
    </PagePanel>
  )
}
