import { useCallback, useEffect, useMemo, useState } from 'react'
import { App as AntApp, Button, Input, Select, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'

import type { FileEntry, StorageItem } from '../../shared/types/domain'
import { getParentPath, isRootPath } from '../../shared/lib/path'
import { AppIcon } from '../../shared/ui/AppIcon'
import { PagePanel } from '../../shared/ui/PagePanel'
import { StatCard } from '../../shared/ui/StatCard'
import { fileBrowserService } from './fileBrowserService'

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

export function FileBrowserPage() {
  const { message } = AntApp.useApp()
  const [storages, setStorages] = useState<StorageItem[]>([])
  const [storageId, setStorageId] = useState('')
  const [path, setPath] = useState('/')
  const [pathInput, setPathInput] = useState('/')
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [storagesLoading, setStoragesLoading] = useState(true)
  const [entriesLoading, setEntriesLoading] = useState(false)

  const storageOptions = storages.map((storage) => ({
    label: storage.name,
    value: storage.id,
  }))

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()

    if (!normalizedQuery) {
      return entries
    }

    return entries.filter((entry) => entry.name.toLocaleLowerCase().includes(normalizedQuery))
  }, [entries, query])

  const selectedStorage = useMemo(
    () => storages.find((storage) => storage.id === storageId),
    [storageId, storages],
  )

  const loadEntries = useCallback(
    async (nextStorageId: string, nextPath: string) => {
      if (!nextStorageId) {
        setEntries([])
        return
      }

      setEntriesLoading(true)

      try {
        const result = await fileBrowserService.listEntries(nextStorageId, nextPath)

        setEntries(result.entries)
        setPath(result.path)
        setPathInput(result.path)
      } catch (error) {
        setEntries([])
        message.error(error instanceof Error ? error.message : '目录读取失败')
      } finally {
        setEntriesLoading(false)
      }
    },
    [message],
  )

  useEffect(() => {
    let mounted = true

    async function loadStorages() {
      setStoragesLoading(true)

      try {
        const loadedStorages = await fileBrowserService.listStorages()

        if (!mounted) {
          return
        }

        setStorages(loadedStorages)

        const firstStorage = loadedStorages[0]
        const firstPath = getDefaultPath(firstStorage)

        setStorageId(firstStorage?.id ?? '')
        setPath(firstPath)
        setPathInput(firstPath)

        if (firstStorage) {
          void loadEntries(firstStorage.id, firstPath)
        } else {
          setEntries([])
        }
      } catch (error) {
        if (mounted) {
          message.error(error instanceof Error ? error.message : '读取存储记录失败')
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
  }, [loadEntries, message])

  const columns: ColumnsType<FileEntry> = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (_, entry) => (
        <span
          className={`file-name-cell${entry.kind === 'folder' ? ' file-name-cell--folder' : ''}`}
        >
          <AppIcon name={entry.kind === 'folder' ? 'folder' : 'file'} />
          {entry.name}
        </span>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 210,
    },
    {
      title: '修改时间',
      dataIndex: 'updatedAt',
      width: 300,
    },
  ]

  function handleCopyPath() {
    void navigator.clipboard.writeText(path)
    message.success('路径已复制')
  }

  function handleRefresh() {
    void loadEntries(storageId, path)
  }

  function handleGoParent() {
    if (!selectedStorage || isRootPath(path)) {
      return
    }

    const parentPath = getParentPath(path)

    setQuery('')
    setPath(parentPath)
    setPathInput(parentPath)
    void loadEntries(storageId, parentPath)
  }

  function handleStorageChange(nextStorageId: string) {
    const nextStorage = storages.find((storage) => storage.id === nextStorageId)
    const nextPath = getDefaultPath(nextStorage)

    setStorageId(nextStorageId)
    setPath(nextPath)
    setPathInput(nextPath)
    setQuery('')
    void loadEntries(nextStorageId, nextPath)
  }

  function handleOpenPath(nextPath = pathInput) {
    const normalizedPath = nextPath.trim() || '/'

    setPath(normalizedPath)
    setPathInput(normalizedPath)
    void loadEntries(storageId, normalizedPath)
  }

  function handleOpenEntry(entry: FileEntry) {
    if (entry.kind !== 'folder') {
      return
    }

    setQuery('')
    setPath(entry.path)
    setPathInput(entry.path)
    void loadEntries(storageId, entry.path)
  }

  const parentButtonDisabled = !selectedStorage || isRootPath(path)
  const folderCount = entries.filter((entry) => entry.kind === 'folder').length
  const fileCount = entries.length - folderCount

  return (
    <PagePanel
      className="browser-panel"
      compact
      eyebrow="Browser"
      subtitle="浏览当前存储目录，快速定位可用于任务扫描的路径。"
      title="存储浏览"
    >
      <div className="summary-grid">
        <StatCard
          detail={selectedStorage?.accessMethod ?? '未选择'}
          icon="storage"
          title="当前存储"
          value={selectedStorage?.name ?? '无'}
        />
        <StatCard detail="当前目录" icon="folder" title="文件夹" tone="amber" value={folderCount} />
        <StatCard detail="当前目录" icon="file" title="文件" tone="green" value={fileCount} />
        <StatCard
          detail={path}
          icon="search"
          title="筛选结果"
          tone="violet"
          value={filteredEntries.length}
        />
      </div>

      <div className="soft-card browser-control-card">
        <div className="browser-toolbar browser-pathbar">
          <Button aria-label="存储类型" icon={<AppIcon name="storage" />} />
          <Button
            aria-label="返回上级目录"
            disabled={parentButtonDisabled}
            icon={<AppIcon name="arrowUp" />}
            title="返回上级目录"
            onClick={handleGoParent}
          />
          <Select
            aria-label="选择存储"
            className="storage-select"
            disabled={storages.length === 0}
            loading={storagesLoading}
            options={storageOptions}
            value={storageId}
            onChange={handleStorageChange}
          />
          <Input
            aria-label="当前路径"
            disabled={!selectedStorage}
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            onBlur={() => handleOpenPath()}
            onPressEnter={() => handleOpenPath()}
          />
          <Button aria-label="复制路径" icon={<AppIcon name="copy" />} onClick={handleCopyPath} />
          <Button aria-label="刷新目录" icon={<AppIcon name="refresh" />} onClick={handleRefresh} />
        </div>

        <div className="browser-toolbar browser-actions">
          <Input
            allowClear
            className="browser-search"
            placeholder="搜索当前目录..."
            prefix={<AppIcon name="search" />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="table-card browser-table-card">
        <Table
          columns={columns}
          dataSource={filteredEntries}
          loading={entriesLoading}
          locale={{ emptyText: selectedStorage ? '当前目录为空' : '请先在存储管理添加存储' }}
          pagination={false}
          rowKey="id"
          rowClassName={(entry) => (entry.kind === 'folder' ? 'file-browser-row--folder' : '')}
          scroll={{ x: 760 }}
          size="middle"
          onRow={(entry) => ({
            onDoubleClick: () => handleOpenEntry(entry),
          })}
        />

        <div className="browser-footer">{filteredEntries.length} 项</div>
      </div>
    </PagePanel>
  )
}
