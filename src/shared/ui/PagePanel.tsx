import type { PropsWithChildren, ReactNode } from 'react'

interface PagePanelProps extends PropsWithChildren {
  title?: string
  subtitle?: string
  eyebrow?: string
  actions?: ReactNode
  className?: string
  compact?: boolean
}

export function PagePanel({
  title,
  subtitle,
  eyebrow,
  actions,
  className = '',
  compact,
  children,
}: PagePanelProps) {
  return (
    <section className={`content-panel ${compact ? 'content-panel-compact' : ''} ${className}`}>
      {(title || subtitle || actions) && (
        <header className="panel-header">
          <div className="panel-title-block">
            {eyebrow ? <span className="panel-eyebrow">{eyebrow}</span> : null}
            {title ? <h1>{title}</h1> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  )
}
