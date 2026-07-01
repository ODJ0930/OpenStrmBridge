import type { ReactNode } from 'react'

import type { AppIconName } from '../types/ui'
import { AppIcon } from './AppIcon'

export type StatCardTone = 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'cyan' | 'slate'

interface StatCardProps {
  title: string
  value: ReactNode
  icon: AppIconName
  detail?: ReactNode
  tone?: StatCardTone
  pulse?: boolean
}

export function StatCard({ title, value, icon, detail, tone = 'blue', pulse }: StatCardProps) {
  return (
    <article className={`stat-card stat-card-${tone}${pulse ? ' stat-card-pulse' : ''}`}>
      <span className="stat-card-icon">
        <AppIcon name={icon} size={18} />
      </span>
      <div className="stat-card-copy">
        <span>{title}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </article>
  )
}
