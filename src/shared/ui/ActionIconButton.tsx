import { Button, Tooltip } from 'antd'

import type { ActionButtonConfig } from '../types/ui'
import { AppIcon } from './AppIcon'

export function ActionIconButton({
  label,
  icon,
  tone = 'muted',
  disabled,
  onClick,
}: ActionButtonConfig) {
  return (
    <Tooltip title={label}>
      <Button
        aria-label={label}
        className={`action-icon action-icon-${tone}`}
        disabled={disabled}
        icon={<AppIcon name={icon} size={14} />}
        shape="circle"
        size="small"
        type="text"
        onClick={onClick}
      />
    </Tooltip>
  )
}
