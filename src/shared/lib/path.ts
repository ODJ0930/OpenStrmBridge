export function isRootPath(currentPath: string) {
  const trimmedPath = currentPath.trim()

  if (!trimmedPath || trimmedPath === '/') {
    return true
  }

  const normalizedPath = trimmedPath.replace(/[\\/]+$/, '')

  return !normalizedPath || normalizedPath === '/' || /^[A-Za-z]:$/.test(normalizedPath)
}

export function getParentPath(currentPath: string) {
  const trimmedPath = currentPath.trim()

  if (!trimmedPath) {
    return '/'
  }

  if (isRootPath(trimmedPath)) {
    return trimmedPath
  }

  const separator = trimmedPath.includes('\\') ? '\\' : '/'
  const normalizedPath = trimmedPath.replace(/[\\/]+$/, '')
  const drivePrefix = normalizedPath.match(/^[A-Za-z]:/)?.[0]
  const parentIndex = normalizedPath.lastIndexOf(separator)

  if (parentIndex < 0) {
    return drivePrefix ? `${drivePrefix}${separator}` : '/'
  }

  if (drivePrefix && parentIndex <= drivePrefix.length) {
    return `${drivePrefix}${separator}`
  }

  if (!drivePrefix && parentIndex === 0) {
    return '/'
  }

  return normalizedPath.slice(0, parentIndex) || '/'
}
