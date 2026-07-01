import { useState } from 'react'
import { Button, Drawer } from 'antd'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../../features/auth/authContext'
import { brandConfig, navItems } from '../config/appConfig'
import { AppIcon } from './AppIcon'
import { BrandMark } from './BrandMark'

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { logout } = useAuth()

  function handleLogout() {
    logout()
    onNavigate?.()
    navigate('/login', { replace: true })
  }

  return (
    <div className="sidebar-inner">
      <div className="brand-row">
        <BrandMark />
        <strong>{brandConfig.name}</strong>
      </div>

      <nav className="side-nav" aria-label="主导航">
        {navItems.map((item) => {
          const isActive =
            location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)

          return (
            <NavLink
              className={`side-nav-link ${isActive ? 'side-nav-link-active' : ''}`}
              key={item.key}
              to={item.path}
              onClick={onNavigate}
            >
              <AppIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="version-block">
          <span>{brandConfig.repositoryLabel}</span>
          <small>{brandConfig.version}</small>
        </div>
        <Button
          block
          className="logout-button"
          icon={<AppIcon name="logout" />}
          danger
          onClick={handleLogout}
        >
          退出
        </Button>
      </div>
    </div>
  )
}

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <SidebarContent />
      </aside>

      <header className="mobile-topbar">
        <Button
          aria-label="打开导航"
          icon={<AppIcon name="menu" />}
          type="text"
          onClick={() => setDrawerOpen(true)}
        />
        <div className="mobile-brand">
          <BrandMark />
          <strong>{brandConfig.name}</strong>
        </div>
      </header>

      <Drawer
        className="mobile-drawer"
        open={drawerOpen}
        placement="left"
        title={brandConfig.name}
        width={280}
        onClose={() => setDrawerOpen(false)}
      >
        <SidebarContent onNavigate={() => setDrawerOpen(false)} />
      </Drawer>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
