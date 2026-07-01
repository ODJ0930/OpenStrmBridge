import { useEffect, useState } from 'react'
import { App as AntApp, Checkbox, Input, InputNumber, Modal, Switch, Tag } from 'antd'

import type {
  StrmAssistantStartResult,
  StrmAssistantStatus,
  StrmAssistantTaskScheduleMode,
} from '../../shared/types/domain'
import { AppIcon } from '../../shared/ui/AppIcon'
import { PagePanel } from '../../shared/ui/PagePanel'
import { StatCard } from '../../shared/ui/StatCard'
import { strmAssistantService } from './pluginService'

type StrmAssistantSettingItem =
  | {
      defaultChecked?: boolean
      description: string
      id: string
      label: string
      type: 'switch'
    }
  | {
      defaultValue: number
      description: string
      id: string
      max: number
      min: number
      type: 'number'
    }

interface StrmAssistantTaskOption {
  description: string
  id: string
  title: string
}

const strmAssistantSettingGroups: Array<{
  id: string
  items: StrmAssistantSettingItem[]
  title: string
}> = [
  {
    id: 'general',
    title: '通用',
    items: [
      {
        description: '电影洗版或剧集有更新后实时提取媒体信息以及片头片尾标记探测或同步，默认关闭。',
        id: 'catchup-mode',
        label: '追更模式',
        type: 'switch',
      },
      {
        defaultValue: 1,
        description:
          '媒体信息提取，视频截图，预览缩略图，声纹提取任务共享，必须在 1 至 20 之间，默认为 1。',
        id: 'extract-workers',
        max: 20,
        min: 1,
        type: 'number',
      },
      {
        defaultValue: 0,
        description: '单线程模式有效，必须在 0 至 60 之间，默认为 0。',
        id: 'single-thread-delay',
        max: 60,
        min: 0,
        type: 'number',
      },
      {
        defaultValue: 1,
        description:
          '刷新演员，剧集，扫外挂字幕，处理本地任务等共享，必须在 1 至 20 之间，默认为 1。',
        id: 'local-workers',
        max: 20,
        min: 1,
        type: 'number',
      },
    ],
  },
  {
    id: 'media-info',
    title: '媒体信息提取',
    items: [
      {
        description: '提取电影或剧集的分集和附加内容的媒体信息，默认关闭。',
        id: 'include-episodes-extras',
        label: '包含分集和附加内容',
        type: 'switch',
      },
      {
        description: '解锁 STRM 视频截图，预览缩略图 BIF，跳过内嵌封面，默认关闭。',
        id: 'preview-thumbnail-enhance',
        label: '视频截图预览缩略图增强',
        type: 'switch',
      },
    ],
  },
  {
    id: 'metadata',
    title: '元数据增强',
    items: [
      {
        defaultValue: 365,
        description: '计划任务剧集元数据刷新的回溯天数，默认为365天。',
        id: 'episode-refresh-days',
        max: 3650,
        min: 1,
        type: 'number',
      },
    ],
  },
  {
    id: 'intro-skip',
    title: '片头片尾探测',
    items: [
      {
        description: '自定义片头声纹探测时长，默认关闭。',
        id: 'native-intro-enhance',
        label: '原生片头探测增强',
        type: 'switch',
      },
      {
        description: '基于播放行为的剧集片头片尾探测，默认关闭。',
        id: 'play-session-intro',
        label: '播放行为片头探测',
        type: 'switch',
      },
    ],
  },
  {
    id: 'experience',
    title: '体验增强',
    items: [
      {
        description: '扫库时自动合并电影和电视节目为多版本，不需符合官方严格的命名规范，默认关闭。',
        id: 'auto-merge-version',
        label: '自动合并多版本',
        type: 'switch',
      },
    ],
  },
]

const strmAssistantSettingColumns = [
  strmAssistantSettingGroups.filter((group) => ['general', 'experience'].includes(group.id)),
  strmAssistantSettingGroups.filter((group) =>
    ['media-info', 'metadata', 'intro-skip'].includes(group.id),
  ),
]

const strmAssistantTaskItems: StrmAssistantTaskOption[] = [
  {
    description: '按偏好刷新剧集缺失的元数据和图片',
    id: 'refresh-episode',
    title: '刷新剧集元数据',
  },
  {
    description: '刷新和修复演员信息，尽可能获取中文及头像',
    id: 'refresh-person',
    title: '刷新演员信息',
  },
  {
    description: '按偏好库内或跨库合并电影和电视节目，扫库后自动运行',
    id: 'merge-version',
    title: '合并多版本',
  },
  {
    description: '单独扫描视频的外挂字幕更新至媒体信息',
    id: 'scan-subtitle',
    title: '扫描外挂字幕',
  },
  {
    description: '导出媒体信息，章节片头片尾标记至 JSON 文件',
    id: 'persist-media-info',
    title: '持久化媒体信息',
  },
  {
    description: '提取视频和音频的媒体信息，以及视频截图',
    id: 'extract-media-info',
    title: '提取媒体信息',
  },
  {
    description: '预提取剧集片头声纹供片头探测后处理',
    id: 'extract-intro-fingerprint',
    title: '提取片头声纹',
  },
  {
    description: '提取视频预览缩略图和章节图',
    id: 'extract-video-thumbnail',
    title: '提取视频缩略图',
  },
  {
    description: '更新本插件至最新版',
    id: 'update-plugin',
    title: '更新本插件',
  },
  {
    description: '强行检查所有带 STRM 文件的视频并补齐媒体信息，包括没有识别出来的电影。',
    id: 'check-missing-media-info',
    title: '检查补漏缺失媒体信息',
  },
  {
    description: '清除由基于行为片头片尾探测产生的标记',
    id: 'clear-chapter-markers',
    title: '清除片头片尾标记',
  },
  {
    description: '获取没有封面的 STRM 视频主封面，适合一些没有封面的未知名文件。',
    id: 'extract-strm-primary-image',
    title: '获取strm视频封面（仅匹配无封面视频）',
  },
]

function renderSettingControl(item: StrmAssistantSettingItem, disabled: boolean) {
  if (item.type === 'switch') {
    return <Switch defaultChecked={item.defaultChecked} disabled={disabled} size="small" />
  }

  if (item.type === 'number') {
    return (
      <InputNumber
        defaultValue={item.defaultValue}
        disabled={disabled}
        max={item.max}
        min={item.min}
        size="small"
      />
    )
  }

  return null
}

function getScheduleDescription(
  schedule: StrmAssistantStatus['taskSchedules'][string] | undefined,
) {
  if (!schedule?.enabled) {
    return '未设置'
  }

  const modes = schedule.modes ?? (schedule.mode ? [schedule.mode] : [])
  const descriptions = []

  if (modes.includes('hourly')) {
    descriptions.push(`每 ${schedule.intervalHours} 小时执行`)
  }

  if (modes.includes('after-strm')) {
    descriptions.push('STRM 完成后执行')
  }

  return descriptions.join('，') || '未设置'
}

export function PluginManagementPage() {
  const { message } = AntApp.useApp()
  const cachedDefaults = strmAssistantService.getCachedDefaults()
  const [loadingStatus, setLoadingStatus] = useState(() => !cachedDefaults)
  const [directoryModalOpen, setDirectoryModalOpen] = useState(false)
  const [manualDirectory, setManualDirectory] = useState('')
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [scheduleModes, setScheduleModes] = useState<StrmAssistantTaskScheduleMode[]>(['hourly'])
  const [scheduleTask, setScheduleTask] = useState<StrmAssistantTaskOption | null>(null)
  const [scheduleIntervalHours, setScheduleIntervalHours] = useState(1)
  const [savingDirectory, setSavingDirectory] = useState(false)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startResult, setStartResult] = useState<StrmAssistantStartResult | null>(null)
  const [status, setStatus] = useState<StrmAssistantStatus | null>(
    () => cachedDefaults?.status ?? null,
  )
  const containerPluginDirectory = status?.containerPluginDirectory?.trim()
  const isManualDirectory = status?.detectionSource === 'manual'
  const installed = Boolean(status?.installed)
  const foundPluginDirectory = Boolean(status?.foundPluginDirectory)
  const directoryTagColor = isManualDirectory
    ? 'processing'
    : foundPluginDirectory
      ? 'success'
      : 'error'
  const directoryTagText = loadingStatus
    ? '探测中'
    : isManualDirectory
      ? '手动设置目录'
      : foundPluginDirectory
        ? '已寻找到目录'
        : '未找到插件目录手动设置'
  const schedules = Object.values(status?.taskSchedules ?? {})
  const scheduledCount = schedules.filter((schedule) => schedule.enabled).length
  const detectedFeatureCount =
    status?.capabilities?.features.filter((item) => item.detected).length ?? 0
  const detectedControlCount =
    status?.capabilities?.controlItems.filter((item) => item.detected).length ?? 0

  useEffect(() => {
    const cachedDefaults = strmAssistantService.getCachedDefaults()

    if (cachedDefaults) {
      return undefined
    }

    let mounted = true

    async function loadStatus() {
      setLoadingStatus(true)

      try {
        const defaults = await strmAssistantService.getDefaults()

        if (mounted) {
          setStatus(defaults.status)
        }
      } catch (error) {
        if (mounted) {
          message.error(error instanceof Error ? error.message : '读取神医助手状态失败')
        }
      } finally {
        if (mounted) {
          setLoadingStatus(false)
        }
      }
    }

    void loadStatus()

    return () => {
      mounted = false
    }
  }, [message])

  async function handleStart() {
    setStarting(true)

    try {
      const result = await strmAssistantService.start()

      setStartResult(result)
      setStatus({
        capabilities: result.capabilities,
        containerPluginDirectory: result.containerPluginDirectory,
        detectionSource: result.detectionSource,
        embyContainerName: result.embyContainerName,
        foundPluginDirectory: result.foundPluginDirectory,
        installed: result.installed,
        pluginDirectory: result.pluginDirectory,
        pluginFileName: result.pluginFileName,
        sourceExists: true,
        sourceFile: result.sourceFile,
        taskSchedules: result.taskSchedules,
        targetFile: result.targetFile,
      })
      message.success(result.message)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '启动神医助手失败')
    } finally {
      setStarting(false)
    }
  }

  function handleSwitchChange(checked: boolean) {
    if (checked) {
      void handleStart()
      return
    }

    if (installed) {
      message.info('神医助手已安装')
    }
  }

  function openDirectoryModal() {
    setManualDirectory(status?.pluginDirectory ?? '')
    setDirectoryModalOpen(true)
  }

  async function handleSaveDirectory() {
    const nextDirectory = manualDirectory.trim()

    if (!nextDirectory) {
      message.error('请填写 Emby 插件目录')
      return
    }

    setSavingDirectory(true)

    try {
      const defaults = await strmAssistantService.setPluginDirectory(nextDirectory)

      setStatus(defaults.status)
      setStartResult(null)
      setDirectoryModalOpen(false)
      message.success('插件目录已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存插件目录失败')
    } finally {
      setSavingDirectory(false)
    }
  }

  function openScheduleModal(task: StrmAssistantTaskOption) {
    const schedule = status?.taskSchedules?.[task.id]
    const modes = schedule?.modes ?? (schedule?.mode ? [schedule.mode] : ['hourly'])

    setScheduleTask(task)
    setScheduleModes(modes.length > 0 ? modes : ['hourly'])
    setScheduleIntervalHours(schedule?.intervalHours ?? 1)
    setScheduleModalOpen(true)
  }

  async function handleSaveSchedule() {
    if (!scheduleTask) {
      return
    }

    if (scheduleModes.length === 0) {
      message.error('请至少选择一种执行逻辑')
      return
    }

    setSavingSchedule(true)

    try {
      const defaults = await strmAssistantService.setTaskSchedule({
        enabled: true,
        intervalHours: scheduleIntervalHours,
        modes: scheduleModes,
        taskId: scheduleTask.id,
        taskName: scheduleTask.title,
      })

      setStatus(defaults.status)
      setScheduleModalOpen(false)
      message.success('计划任务执行逻辑已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存计划任务失败')
    } finally {
      setSavingSchedule(false)
    }
  }

  return (
    <PagePanel
      className="strm-assistant-panel"
      eyebrow="Plugin"
      subtitle="管理插件安装状态、功能开关和自动计划任务。"
      title="神医助手（适配本程序的社区开源版本）"
    >
      <div className="summary-grid">
        <StatCard
          detail={installed ? '插件已复制并可用' : '等待启动'}
          icon={installed ? 'check' : 'plug'}
          title="安装状态"
          tone={installed ? 'green' : 'amber'}
          value={installed ? '已安装' : '未安装'}
        />
        <StatCard
          detail={directoryTagText}
          icon="folder"
          title="插件目录"
          tone={foundPluginDirectory ? 'cyan' : 'rose'}
          value={foundPluginDirectory ? '已定位' : '待设置'}
        />
        <StatCard
          detail="已启用执行逻辑"
          icon="calendar"
          title="计划任务"
          tone="violet"
          value={scheduledCount}
        />
        <StatCard
          detail={`${detectedControlCount} 个控制项可识别`}
          icon="sparkles"
          title="检测功能"
          tone="blue"
          value={detectedFeatureCount}
        />
      </div>

      <section className="strm-assistant-card">
        <div className="strm-assistant-main">
          <div className="plugin-title">
            <AppIcon name="plug" />
            <a
              className="plugin-title-link"
              href="https://github.com/ODJ0930/StrmAssistant"
              rel="noreferrer"
              target="_blank"
            >
              StrmAssistantLite.dll
            </a>
          </div>
          <Switch
            checked={installed || starting}
            checkedChildren="已启动"
            className="strm-assistant-start-switch"
            disabled={loadingStatus}
            loading={starting}
            onChange={handleSwitchChange}
            unCheckedChildren="启动功能"
          />
        </div>
        <div className="strm-assistant-detection">
          <div className="strm-assistant-metric">
            <span>安装状态</span>
            <Tag color={installed ? 'success' : undefined}>{installed ? '已安装' : '未安装'}</Tag>
          </div>
          <div className="strm-assistant-metric">
            <span>插件目录</span>
            <button
              className="strm-assistant-tag-button"
              disabled={loadingStatus}
              onClick={openDirectoryModal}
              type="button"
            >
              <Tag color={directoryTagColor}>{directoryTagText}</Tag>
            </button>
          </div>
          <button
            className="strm-assistant-paths"
            disabled={loadingStatus}
            onClick={openDirectoryModal}
            type="button"
          >
            <p>
              {loadingStatus
                ? '正在探测 Emby 插件目录'
                : foundPluginDirectory
                  ? `${isManualDirectory ? '手动目录' : '主机目录'}：${status?.pluginDirectory ?? ''}`
                  : '未找到可用插件目录'}
            </p>
            {containerPluginDirectory ? <p>容器目录：{containerPluginDirectory}</p> : null}
          </button>
        </div>

        {startResult ? (
          <p className="strm-assistant-result">
            已复制到 {startResult.pluginDirectory}，Emby 已重启。
          </p>
        ) : null}
      </section>
      <section
        className={installed ? 'strm-assistant-options' : 'strm-assistant-options is-disabled'}
      >
        <header>
          <div>
            <h3>插件功能</h3>
            <p>{installed ? '神医助手插件已启动' : '未启动时不可修改'}</p>
          </div>
          <Tag color={installed ? 'success' : undefined}>{installed ? '可修改' : '未启动'}</Tag>
        </header>

        <div className="strm-assistant-option-grid">
          {strmAssistantSettingColumns.map((column, columnIndex) => (
            <div className="strm-assistant-option-column" key={columnIndex}>
              {column.map((group) => (
                <section className="strm-assistant-option-group" key={group.id}>
                  <h4>{group.title}</h4>
                  <div className="strm-assistant-option-list">
                    {group.items.map((item) => (
                      <article className="strm-assistant-option-row" key={item.id}>
                        <div className="strm-assistant-option-control">
                          {renderSettingControl(item, !installed)}
                        </div>
                        <div>
                          {item.type === 'switch' ? <strong>{item.label}</strong> : null}
                          <p>{item.description}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ))}
        </div>

        <div className="strm-assistant-task-group">
          <h3>计划任务</h3>
          <div className="strm-assistant-task-list">
            {strmAssistantTaskItems.map((task) => (
              <button
                className="strm-assistant-task-item"
                disabled={!installed}
                key={task.id}
                onClick={() => openScheduleModal(task)}
                type="button"
              >
                <strong>{task.title}</strong>
                <p>{task.description}</p>
                <span className="strm-assistant-task-schedule">
                  执行逻辑：{getScheduleDescription(status?.taskSchedules?.[task.id])}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
      <Modal
        confirmLoading={savingSchedule}
        okText="保存"
        onCancel={() => setScheduleModalOpen(false)}
        onOk={() => void handleSaveSchedule()}
        open={scheduleModalOpen}
        title={scheduleTask ? `设置计划任务：${scheduleTask.title}` : '设置计划任务'}
      >
        <div className="strm-assistant-schedule-form">
          <Checkbox.Group
            onChange={(values) => setScheduleModes(values as StrmAssistantTaskScheduleMode[])}
            value={scheduleModes}
          >
            <Checkbox value="hourly">按小时重复执行</Checkbox>
            <Checkbox value="after-strm">STRM 生成任务完成后执行一次</Checkbox>
          </Checkbox.Group>
          {scheduleModes.includes('hourly') ? (
            <label className="strm-assistant-schedule-hours">
              <span>间隔小时</span>
              <InputNumber
                max={168}
                min={1}
                onChange={(value) => setScheduleIntervalHours(Number(value) || 1)}
                value={scheduleIntervalHours}
              />
            </label>
          ) : null}
          {scheduleModes.includes('after-strm') ? (
            <p className="strm-assistant-schedule-note">
              每次左侧任务管理中的 STRM 生成任务完成后，自动触发该计划任务一次。
            </p>
          ) : null}
        </div>
      </Modal>
      <Modal
        confirmLoading={savingDirectory}
        okText="保存"
        onCancel={() => setDirectoryModalOpen(false)}
        onOk={() => void handleSaveDirectory()}
        open={directoryModalOpen}
        title="设置 Emby 插件目录"
      >
        <Input
          autoFocus
          onChange={(event) => setManualDirectory(event.target.value)}
          onPressEnter={() => void handleSaveDirectory()}
          placeholder="例如 D:\\tool\\OpenStrmBridge\\data\\emby\\config\\plugins"
          value={manualDirectory}
        />
      </Modal>
    </PagePanel>
  )
}
