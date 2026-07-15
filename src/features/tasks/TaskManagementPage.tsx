import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'

import type { FileEntry, StorageItem, TaskItem, TaskStatus } from '../../shared/types/domain'
import { getParentPath, isRootPath } from '../../shared/lib/path'
import { AppIcon } from '../../shared/ui/AppIcon'
import { ActionIconButton } from '../../shared/ui/ActionIconButton'
import { PagePanel } from '../../shared/ui/PagePanel'
import { StatCard } from '../../shared/ui/StatCard'
import { fileBrowserService } from '../file-browser/fileBrowserService'
import { settingsService } from '../settings/settingsService'
import { storageService } from '../storage/storageService'
import { taskService } from './taskService'

const defaultOutputRoot = '/opt/openstrmbridge/strm'

interface TaskFormValues {
  name: string
  storageId: string
  path: string
  schedule: string
  aiRenameBeforeStrm: boolean
  directoryTimeCheck: boolean
  incremental: boolean
  preRefreshOpenListCache: boolean
}

const defaultTaskValues: TaskFormValues = {
  name: '',
  storageId: '',
  path: '/',
  schedule: '*/5 * * * *',
  aiRenameBeforeStrm: false,
  directoryTimeCheck: true,
  incremental: true,
  preRefreshOpenListCache: false,
}

interface LegacyTaskFields {
  aiRenameBeforeStrm?: boolean
  aiRenameFirst?: boolean
  cron?: string
  cronExpression?: string
  crontab?: string
  directoryMtimeCheck?: boolean
  enableDirectoryTimeCheck?: boolean
  enableIncremental?: boolean
  incrementalMode?: boolean
  name?: string
  path?: string
  preRefreshAlistCache?: boolean
  preAiRename?: boolean
  preRefreshOpenlistCache?: boolean
  refreshOpenListCache?: boolean
  scanPath?: string
  scan_path?: string
  schedule?: string
  sourcePath?: string
  storage?: string | { id?: string; name?: string }
  storageID?: string
  storageId?: string
  storageName?: string
  storage_id?: string
  taskName?: string
  title?: string
}

function safePathSegment(value: string, fallback = 'task') {
  const safeValue = value
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')

  return safeValue || fallback
}

function normalizeOutputRoot(outputRoot: string) {
  const normalized = outputRoot.trim().replace(/\/+/g, '/').replace(/\/+$/, '')

  if (!normalized) {
    return defaultOutputRoot
  }

  return normalized
}

function getTaskOutputPath(taskName: string, outputRoot = defaultOutputRoot) {
  return `${normalizeOutputRoot(outputRoot)}/${safePathSegment(taskName)}`.replace(/\/+/g, '/')
}

function getDefaultPath(storage: StorageItem | undefined) {
  if (!storage) {
    return '/'
  }

  if (storage.accessMethod === 'local') {
    return storage.local?.path || storage.rootPath || storage.endpoint || '/'
  }

  if (storage.accessMethod === 'openlist') {
    return storage.openlist?.basePath || storage.rootPath || '/'
  }

  return storage.rootPath || '/'
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }

    const normalized = value.trim()

    if (normalized) {
      return normalized
    }
  }

  return ''
}

function firstBoolean(defaultValue: boolean, ...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value
    }
  }

  return defaultValue
}

function findTaskStorage(task: LegacyTaskFields, storages: StorageItem[] = []) {
  const storageObject = typeof task.storage === 'string' ? undefined : task.storage
  const storageId = firstText(task.storageId, task.storage_id, task.storageID, storageObject?.id)
  const storageName = firstText(
    typeof task.storage === 'string' ? task.storage : storageObject?.name,
    task.storageName,
  )

  return (
    storages.find((storage) => storage.id === storageId) ??
    storages.find((storage) => storage.name === storageName)
  )
}

function taskToFormValues(task: TaskItem, storages: StorageItem[] = []): TaskFormValues {
  const legacyTask = task as LegacyTaskFields
  const storage = findTaskStorage(legacyTask, storages)

  return {
    name: firstText(legacyTask.name, legacyTask.taskName, legacyTask.title),
    storageId:
      storage?.id ?? firstText(legacyTask.storageId, legacyTask.storage_id, legacyTask.storageID),
    path: firstText(
      legacyTask.path,
      legacyTask.scanPath,
      legacyTask.scan_path,
      legacyTask.sourcePath,
    ),
    schedule: firstText(
      legacyTask.schedule,
      legacyTask.cron,
      legacyTask.crontab,
      legacyTask.cronExpression,
    ),
    aiRenameBeforeStrm: firstBoolean(
      defaultTaskValues.aiRenameBeforeStrm,
      task.aiRenameBeforeStrm,
      legacyTask.aiRenameFirst,
      legacyTask.preAiRename,
    ),
    directoryTimeCheck: firstBoolean(
      defaultTaskValues.directoryTimeCheck,
      task.directoryTimeCheck,
      legacyTask.directoryMtimeCheck,
      legacyTask.enableDirectoryTimeCheck,
    ),
    incremental: firstBoolean(
      defaultTaskValues.incremental,
      task.incremental,
      legacyTask.incrementalMode,
      legacyTask.enableIncremental,
    ),
    preRefreshOpenListCache: firstBoolean(
      defaultTaskValues.preRefreshOpenListCache,
      task.preRefreshOpenListCache,
      legacyTask.preRefreshOpenlistCache,
      legacyTask.refreshOpenListCache,
      legacyTask.preRefreshAlistCache,
    ),
  }
}

function createTaskFromValues(
  values: TaskFormValues,
  storages: StorageItem[],
  outputRoot: string,
  editingTask?: TaskItem | null,
): TaskItem {
  const storage = storages.find((item) => item.id === values.storageId)
  const name = values.name.trim()

  return {
    id: editingTask?.id ?? `task-${Date.now()}`,
    name,
    storage: storage?.name ?? editingTask?.storage ?? '',
    storageId: values.storageId,
    path: values.path.trim() || getDefaultPath(storage),
    schedule: values.schedule.trim() || '*/5 * * * *',
    nextRun: editingTask?.nextRun ?? '手动运行',
    status: editingTask?.status ?? 'idle',
    aiRenameBeforeStrm: values.aiRenameBeforeStrm === true,
    directoryTimeCheck: values.directoryTimeCheck !== false,
    incremental: values.incremental !== false,
    preRefreshOpenListCache:
      storage?.accessMethod === 'openlist' && values.preRefreshOpenListCache === true,
    outputPath: getTaskOutputPath(name, outputRoot),
    lastLog: editingTask?.lastLog,
    lastResult: editingTask?.lastResult,
    lastRunAt: editingTask?.lastRunAt,
  }
}

function updateTaskList(tasks: TaskItem[], nextTask: TaskItem) {
  const index = tasks.findIndex((task) => task.id === nextTask.id)

  if (index < 0) {
    return [nextTask, ...tasks]
  }

  return tasks.map((task) => (task.id === nextTask.id ? nextTask : task))
}

function renderTaskStatus(status: TaskStatus) {
  if (status === 'running') {
    return <span className="status-pill status-pill-info">运行中</span>
  }

  if (status === 'failed') {
    return <span className="status-pill status-pill-danger">失败</span>
  }

  if (status === 'partial') {
    return <span className="status-pill status-pill-warning">部分失败</span>
  }

  if (status === 'succeeded') {
    return <span className="status-pill status-pill-success">成功</span>
  }

  return <span className="status-pill">空闲</span>
}

function getTaskLogLineClassName(line: string) {
  const text = line.trim()
  const hasFailureCount = /(?:失败|目录读取失败)\s*[1-9]\d*\s*个/.test(text)

  if (
    /^(生成失败|目录读取失败|OpenList 目录缓存刷新失败|更新 STRM 索引失败)/.test(text) ||
    /任务失败:/.test(text) ||
    hasFailureCount
  ) {
    return 'task-log-line task-log-line-danger'
  }

  if (
    /^(生成成功|生成:|跳过已存在|已刷新 OpenList 目录缓存|已更新 STRM 索引)/.test(text) ||
    (/^生成完成/.test(text) && !hasFailureCount) ||
    /任务完成$/.test(text)
  ) {
    return 'task-log-line task-log-line-success'
  }

  return 'task-log-line'
}

function renderTaskLogContent(logContent: string) {
  const content = logContent || '暂无日志。运行任务后，这里会显示扫描与 STRM 生成记录。'
  const lines = content.split('\n')

  return lines.map((line, index) => (
    <span className={getTaskLogLineClassName(line)} key={`${index}-${line}`}>
      {line}
      {index < lines.length - 1 ? '\n' : null}
    </span>
  ))
}

export function TaskManagementPage() {
  const { message, modal } = AntApp.useApp()
  const [form] = Form.useForm<TaskFormValues>()
  const watchedName = Form.useWatch('name', form) ?? ''
  const watchedStorageId = Form.useWatch('storageId', form) ?? ''
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [storages, setStorages] = useState<StorageItem[]>([])
  const [taskOutputRoot, setTaskOutputRoot] = useState(defaultOutputRoot)
  const [tasksLoading, setTasksLoading] = useState(true)
  const [runningTaskIds, setRunningTaskIds] = useState<Set<string>>(new Set())
  const [runningAll, setRunningAll] = useState(false)
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [logModalOpen, setLogModalOpen] = useState(false)
  const [logTaskId, setLogTaskId] = useState('')
  const [logTaskName, setLogTaskName] = useState('')
  const [logContent, setLogContent] = useState('')
  const [logLoading, setLogLoading] = useState(false)
  const [logStatus, setLogStatus] = useState<TaskStatus>('idle')
  const [pathPickerOpen, setPathPickerOpen] = useState(false)
  const [pathPickerPath, setPathPickerPath] = useState('/')
  const [pathPickerSelectedPath, setPathPickerSelectedPath] = useState('')
  const [pathPickerEntries, setPathPickerEntries] = useState<FileEntry[]>([])
  const [pathPickerLoading, setPathPickerLoading] = useState(false)

  const storageOptions = useMemo(
    () =>
      storages.map((storage) => ({
        label: storage.name,
        value: storage.id,
      })),
    [storages],
  )

  const selectedStorage = useMemo(
    () => storages.find((storage) => storage.id === watchedStorageId),
    [storages, watchedStorageId],
  )

  const loadPageData = useCallback(async () => {
    setTasksLoading(true)

    try {
      const [loadedTasks, loadedStorages, loadedSettings] = await Promise.all([
        taskService.list(),
        storageService.list(),
        settingsService.loadSettings(),
      ])

      setTasks(loadedTasks)
      setStorages(loadedStorages)
      setTaskOutputRoot(loadedSettings.strm.outputRoot)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取任务失败')
    } finally {
      setTasksLoading(false)
    }
  }, [message])

  useEffect(() => {
    let mounted = true

    async function loadInitialData() {
      setTasksLoading(true)

      try {
        const [loadedTasks, loadedStorages, loadedSettings] = await Promise.all([
          taskService.list(),
          storageService.list(),
          settingsService.loadSettings(),
        ])

        if (!mounted) {
          return
        }

        setTasks(loadedTasks)
        setStorages(loadedStorages)
        setTaskOutputRoot(loadedSettings.strm.outputRoot)
      } catch (error) {
        if (mounted) {
          message.error(error instanceof Error ? error.message : '读取任务失败')
        }
      } finally {
        if (mounted) {
          setTasksLoading(false)
        }
      }
    }

    void loadInitialData()

    return () => {
      mounted = false
    }
  }, [message])

  useEffect(() => {
    if (!taskModalOpen) {
      return
    }

    if (editingTask) {
      const values = taskToFormValues(editingTask, storages)

      form.resetFields()
      form.setFieldsValue(values)
      setPathPickerEntries([])
      setPathPickerPath(values.path || '/')
      setPathPickerSelectedPath('')
      return
    }

    const firstStorage = storages[0]
    const values = {
      ...defaultTaskValues,
      storageId: firstStorage?.id ?? '',
      path: getDefaultPath(firstStorage),
    }

    form.resetFields()
    form.setFieldsValue(values)
    setPathPickerEntries([])
    setPathPickerPath(values.path)
    setPathPickerSelectedPath('')
  }, [editingTask, form, storages, taskModalOpen])

  useEffect(() => {
    if (!logModalOpen || !logTaskId || logStatus !== 'running') {
      return
    }

    let cancelled = false
    let timerId: number | undefined

    async function refreshRunningLog() {
      try {
        const result = await taskService.getLog(logTaskId)

        if (cancelled) {
          return
        }

        setLogTaskName(result.taskName)
        setLogContent(result.log)
        setLogStatus(result.status)

        if (result.status === 'running') {
          timerId = window.setTimeout(refreshRunningLog, 1000)
        }
      } catch (error) {
        if (!cancelled) {
          message.error(error instanceof Error ? error.message : '读取任务日志失败')
          setLogStatus('failed')
        }
      }
    }

    timerId = window.setTimeout(refreshRunningLog, 1000)

    return () => {
      cancelled = true

      if (timerId) {
        window.clearTimeout(timerId)
      }
    }
  }, [logModalOpen, logStatus, logTaskId, message])

  useEffect(() => {
    if (taskModalOpen || pathPickerOpen) {
      return
    }

    let cancelled = false
    let timerId: number | undefined

    async function refreshTaskList() {
      try {
        const loadedTasks = await taskService.list()

        if (!cancelled) {
          setTasks(loadedTasks)
        }
      } catch {
        // Keep the foreground workflow quiet if the backend is temporarily busy.
      } finally {
        if (!cancelled) {
          timerId = window.setTimeout(refreshTaskList, 30_000)
        }
      }
    }

    timerId = window.setTimeout(refreshTaskList, 30_000)

    return () => {
      cancelled = true

      if (timerId) {
        window.clearTimeout(timerId)
      }
    }
  }, [pathPickerOpen, taskModalOpen])

  function openCreateModal() {
    setEditingTask(null)
    setTaskModalOpen(true)
  }

  function openEditModal(task: TaskItem) {
    setEditingTask(task)
    setTaskModalOpen(true)
  }

  function handleStorageChange(storageId: string) {
    const storage = storages.find((item) => item.id === storageId)
    form.setFieldsValue({
      path: getDefaultPath(storage),
      preRefreshOpenListCache:
        storage?.accessMethod === 'openlist'
          ? form.getFieldValue('preRefreshOpenListCache') === true
          : false,
      storageId,
    })
    setPathPickerEntries([])
    setPathPickerPath(getDefaultPath(storage))
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

    const currentPath = form.getFieldValue('path')?.trim() || getDefaultPath(storage)

    setPathPickerOpen(true)
    setPathPickerPath(currentPath)
    setPathPickerSelectedPath('')
    setPathPickerEntries([])
    void loadPathPickerEntries(storageId, currentPath)
  }

  function handlePathPickerParent() {
    if (!watchedStorageId || isRootPath(pathPickerPath)) {
      return
    }

    void loadPathPickerEntries(watchedStorageId, getParentPath(pathPickerPath))
  }

  function handlePathPickerRefresh() {
    if (!watchedStorageId) {
      return
    }

    void loadPathPickerEntries(watchedStorageId, pathPickerPath)
  }

  function handleSelectPath(nextPath: string) {
    form.setFieldsValue({ path: nextPath })
    setPathPickerOpen(false)
  }

  function handleUsePathPickerPath() {
    handleSelectPath(pathPickerSelectedPath || pathPickerPath)
  }

  async function handleRunAll() {
    if (tasks.length === 0) {
      message.info('暂无可运行任务')
      return
    }

    setRunningAll(true)
    setTasks((current) => current.map((task) => ({ ...task, status: 'running' })))

    try {
      const result = await taskService.runAll()
      const failedCount = result.results.filter((item) => 'error' in item).length

      setTasks(result.tasks)

      if (failedCount > 0) {
        message.warning(`任务运行完成，${failedCount} 个任务失败`)
      } else {
        message.success('所有任务运行完成')
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '运行全部任务失败')
      void loadPageData()
    } finally {
      setRunningAll(false)
    }
  }

  async function handleToggleRun(task: TaskItem) {
    if (task.status === 'running') {
      try {
        const stoppedTask = await taskService.stop(task.id)
        setTasks((current) => updateTaskList(current, stoppedTask))
        message.success(`已停止任务：${task.name}`)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '停止任务失败')
      }
      return
    }

    setLogTaskId(task.id)
    setLogTaskName(task.name)
    setLogContent('准备运行任务，等待日志输出...')
    setLogStatus('running')
    setLogModalOpen(true)
    setRunningTaskIds((current) => new Set(current).add(task.id))
    setTasks((current) =>
      current.map((item) => (item.id === task.id ? { ...item, status: 'running' } : item)),
    )

    try {
      const response = await taskService.run(task.id)

      setTasks((current) => updateTaskList(current, response.task))
      setLogContent(response.task.lastLog ?? '')
      setLogStatus(response.task.status)
      const aiRenameSummary =
        response.result.aiRenameStatus && response.result.aiRenameStatus !== 'skipped'
          ? `，AI 提交 ${response.result.aiRenameSubmittedGroups ?? 0} 个目录，增量跳过 ${response.result.aiRenameUnchangedGroups ?? 0} 个目录`
          : ''

      if (response.result.status === 'partial' || response.result.partial) {
        message.warning(
          `${task.name} 部分完成：生成 ${response.result.generated} 个，跳过 ${response.result.skipped} 个，清理旧 STRM ${response.result.cleanupDeleted ?? 0} 个，失败 ${response.result.failed} 个${aiRenameSummary}，请查看日志`,
        )
      } else if (response.result.ok) {
        message.success(
          `${task.name} 已生成 ${response.result.generated} 个 STRM，跳过 ${response.result.skipped} 个，清理旧 STRM ${response.result.cleanupDeleted ?? 0} 个${aiRenameSummary}`,
        )
      } else {
        message.warning(`${task.name} 运行完成，但存在失败项，请查看日志`)
      }
    } catch (error) {
      setTasks((current) =>
        current.map((item) => (item.id === task.id ? { ...item, status: 'failed' } : item)),
      )
      setLogStatus('failed')
      message.error(error instanceof Error ? error.message : '运行任务失败')
    } finally {
      setRunningTaskIds((current) => {
        const next = new Set(current)
        next.delete(task.id)
        return next
      })
    }
  }

  function handleDelete(task: TaskItem) {
    modal.confirm({
      title: `删除任务 ${task.name}`,
      content: '删除后会从后端任务记录中移除，不会删除已经生成的 STRM 文件。',
      okButtonProps: { danger: true },
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        try {
          await taskService.remove(task.id)
          setTasks((current) => current.filter((item) => item.id !== task.id))
          message.success('任务已删除')
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除任务失败')
          throw error
        }
      },
    })
  }

  async function handleSaveTask(values: TaskFormValues) {
    const savedTask = await taskService.save(
      createTaskFromValues(values, storages, taskOutputRoot, editingTask),
    )

    setTasks((current) => updateTaskList(current, savedTask))
    setTaskModalOpen(false)
    message.success(editingTask ? '任务已保存' : '任务已添加')
  }

  async function handleOpenLog(task: TaskItem) {
    setLogTaskId(task.id)
    setLogTaskName(task.name)
    setLogContent('')
    setLogStatus(task.status)
    setLogModalOpen(true)
    setLogLoading(true)

    try {
      const result = await taskService.getLog(task.id)
      setLogTaskName(result.taskName)
      setLogContent(result.log)
      setLogStatus(result.status)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取任务日志失败')
      setLogContent('')
      setLogStatus('failed')
    } finally {
      setLogLoading(false)
    }
  }

  const pathPickerColumns: ColumnsType<FileEntry> = [
    {
      title: '文件夹',
      dataIndex: 'name',
      render: (_, entry) => (
        <span className="file-name-cell file-name-cell--folder">
          <AppIcon name="folder" />
          {entry.name}
        </span>
      ),
    },
    {
      title: '路径',
      dataIndex: 'path',
      ellipsis: true,
    },
  ]

  const columns: ColumnsType<TaskItem> = [
    {
      title: '任务名',
      dataIndex: 'name',
      width: 170,
      fixed: 'left',
    },
    {
      title: '存储',
      dataIndex: 'storage',
      width: 150,
    },
    {
      title: '路径',
      dataIndex: 'path',
      width: 240,
    },
    {
      title: '定时',
      dataIndex: 'schedule',
      width: 150,
    },
    {
      title: 'AI 预处理',
      dataIndex: 'aiRenameBeforeStrm',
      width: 110,
      render: (enabled: boolean) => (
        <span className={enabled ? 'status-pill status-pill-info' : 'status-pill'}>
          {enabled ? '已开启' : '关闭'}
        </span>
      ),
    },
    {
      title: '下次运行',
      dataIndex: 'nextRun',
      width: 190,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (status: TaskStatus) => renderTaskStatus(status),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_, task) => (
        <Space size={6}>
          <ActionIconButton
            disabled={runningTaskIds.has(task.id)}
            icon={task.status === 'running' ? 'stop' : 'play'}
            label={task.status === 'running' ? '停止任务' : '运行任务'}
            tone={task.status === 'running' ? 'danger' : 'primary'}
            onClick={() => void handleToggleRun(task)}
          />
          <ActionIconButton icon="edit" label="编辑任务" onClick={() => openEditModal(task)} />
          <ActionIconButton
            icon="logs"
            label="查看日志"
            tone="cyan"
            onClick={() => void handleOpenLog(task)}
          />
          <ActionIconButton
            icon="delete"
            label="删除任务"
            tone="danger"
            onClick={() => handleDelete(task)}
          />
        </Space>
      ),
    },
  ]

  const outputPath = getTaskOutputPath(watchedName, taskOutputRoot)
  const runningCount = tasks.filter((task) => task.status === 'running').length
  const failedCount = tasks.filter(
    (task) => task.status === 'failed' || task.status === 'partial',
  ).length
  const totalMediaCount = tasks.reduce(
    (total, task) => total + (task.lastResult?.mediaFiles ?? task.lastResult?.generated ?? 0),
    0,
  )

  return (
    <PagePanel
      actions={
        <Space wrap>
          <Button
            disabled={tasks.length === 0}
            icon={<AppIcon name="play" />}
            loading={runningAll}
            type="primary"
            onClick={() => void handleRunAll()}
          >
            运行所有
          </Button>
          <Button icon={<AppIcon name="plus" />} type="primary" onClick={openCreateModal}>
            添加任务
          </Button>
        </Space>
      }
      eyebrow="STRM"
      subtitle="任务运行、日志查看和输出目录集中在这里。"
      title="任务管理"
    >
      <div className="summary-grid">
        <StatCard
          detail={`${storages.length} 个可用存储`}
          icon="tasks"
          title="任务总数"
          value={tasks.length}
        />
        <StatCard
          detail={runningCount > 0 ? '正在生成 STRM' : '没有运行中的任务'}
          icon="activity"
          pulse={runningCount > 0}
          title="运行中"
          tone="cyan"
          value={runningCount}
        />
        <StatCard
          detail={failedCount > 0 ? '建议查看日志' : '当前无失败任务'}
          icon={failedCount > 0 ? 'alert' : 'check'}
          title="异常任务"
          tone={failedCount > 0 ? 'rose' : 'green'}
          value={failedCount}
        />
        <StatCard
          detail={taskOutputRoot}
          icon="folder"
          title="总影片数"
          tone="violet"
          value={totalMediaCount}
        />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={tasks}
          loading={tasksLoading}
          locale={{ emptyText: '暂无任务，请先添加任务并选择一个已配置的存储' }}
          pagination={false}
          rowKey="id"
          scroll={{ x: 1230 }}
          size="middle"
        />
      </div>

      <Modal
        forceRender
        okText="保存"
        open={taskModalOpen}
        title={editingTask ? '编辑任务' : '添加任务'}
        width={760}
        afterOpenChange={(open) => {
          if (!open) {
            form.resetFields()
            setEditingTask(null)
          }
        }}
        onCancel={() => setTaskModalOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" preserve={false} onFinish={handleSaveTask}>
          <Alert
            className="task-output-alert"
            message={
              <span>
                STRM 将保存在： <code>{outputPath}</code>
              </span>
            }
            type="info"
          />

          <Form.Item
            extra="任务名称会用于 STRM 输出目录"
            label="任务名称"
            name="name"
            rules={[{ required: true, message: '请输入任务名称' }]}
          >
            <Input placeholder="movie" />
          </Form.Item>

          <Form.Item
            label="使用存储"
            name="storageId"
            rules={[{ required: true, message: '请选择存储' }]}
          >
            <Select
              options={storageOptions}
              placeholder="请先在存储管理添加存储"
              onChange={handleStorageChange}
            />
          </Form.Item>

          <Form.Item
            extra="存储中媒体文件的路径"
            label="扫描路径"
            name="path"
            rules={[{ required: true, message: '请输入扫描路径' }]}
          >
            <Input
              placeholder="请输入或选择扫描路径"
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
            extra={
              <span>
                格式：<code>分 时 日 月 周</code>，如 <code>0 0 * * *</code> 表示每天凌晨。
              </span>
            }
            label="执行时间（Crontab）"
            name="schedule"
            rules={[{ required: true, message: '请输入 cron 表达式' }]}
          >
            <Input placeholder="*/5 * * * *" />
          </Form.Item>

          <div className="task-switch-row">
            <Form.Item name="directoryTimeCheck" noStyle valuePropName="checked">
              <Switch />
            </Form.Item>
            <div>
              <strong>目录时间检查</strong>
              <p>开启后会记录配置状态，后续接入调度器时可用于减少重复扫描。</p>
            </div>
          </div>

          <div className="task-switch-row">
            <Form.Item name="incremental" noStyle valuePropName="checked">
              <Switch />
            </Form.Item>
            <div>
              <strong>增量生成模式</strong>
              <p>已有 STRM 指向未变时直接跳过；完整扫描成功后会自动删除云盘中已失效的旧 STRM。</p>
            </div>
          </div>

          <div className="task-switch-row">
            <Form.Item name="aiRenameBeforeStrm" noStyle valuePropName="checked">
              <Switch />
            </Form.Item>
            <div>
              <strong>生成 STRM 前先执行 AI 重命名</strong>
              <p>
                使用“AI 自动重命名”页面中的全局接口、命名、目录重建和 TMDB 设置；AI
                完成后才开始扫描并生成 STRM。
              </p>
            </div>
          </div>

          <div className="task-switch-row">
            <Form.Item name="preRefreshOpenListCache" noStyle valuePropName="checked">
              <Switch disabled={selectedStorage?.accessMethod !== 'openlist'} />
            </Form.Item>
            <div>
              <strong>预先进行 OpenList 目录缓存刷新</strong>
              <p>避免由于缓存新加入的文件没有读取到，仅对 OpenList / Alist 存储生效。</p>
            </div>
          </div>
        </Form>
      </Modal>

      <Modal
        footer={
          <Space>
            <Button onClick={() => setPathPickerOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleUsePathPickerPath}>
              使用当前路径
            </Button>
          </Space>
        }
        open={pathPickerOpen}
        title={`选择扫描路径${selectedStorage ? ` - ${selectedStorage.name}` : ''}`}
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
          <Input readOnly value={pathPickerPath} />
          <Button icon={<AppIcon name="refresh" />} onClick={handlePathPickerRefresh}>
            刷新
          </Button>
        </div>

        <Table
          columns={pathPickerColumns}
          dataSource={pathPickerEntries}
          loading={pathPickerLoading}
          locale={{ emptyText: '当前目录没有可选文件夹，可以直接使用当前路径' }}
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
          <Button type="primary" onClick={() => setLogModalOpen(false)}>
            关闭
          </Button>
        }
        loading={logLoading}
        open={logModalOpen}
        title={`任务日志 - ${logTaskName}${logStatus === 'running' ? '（运行中）' : ''}`}
        width={780}
        onCancel={() => setLogModalOpen(false)}
      >
        <pre className="task-log-viewer">{renderTaskLogContent(logContent)}</pre>
      </Modal>
    </PagePanel>
  )
}
