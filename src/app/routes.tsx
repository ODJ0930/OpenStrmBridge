import { Navigate, useLocation, useRoutes } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'

import { ApiAccessPage } from '../features/api-access/ApiAccessPage'
import { LoginPage } from '../features/auth/LoginPage'
import { useAuth } from '../features/auth/authContext'
import { FileBrowserPage } from '../features/file-browser/FileBrowserPage'
import { PluginManagementPage } from '../features/plugins/PluginManagementPage'
import { StorageManagementPage } from '../features/storage/StorageManagementPage'
import { SystemSettingsPage } from '../features/settings/SystemSettingsPage'
import { TaskManagementPage } from '../features/tasks/TaskManagementPage'
import { routes } from '../shared/config/appConfig'
import { AppLayout } from '../shared/ui/AppLayout'

function ProtectedLayout() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <AppLayout />
}

function LoginRoute() {
  const { isAuthenticated } = useAuth()

  if (isAuthenticated) {
    return <Navigate to={routes.tasks.path} replace />
  }

  return <LoginPage />
}

const routeDefinitions: RouteObject[] = [
  {
    path: '/login',
    element: <LoginRoute />,
  },
  {
    path: '/',
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <Navigate to={routes.tasks.path} replace /> },
      { path: routes.tasks.path.slice(1), element: <TaskManagementPage /> },
      { path: routes.storage.path.slice(1), element: <StorageManagementPage /> },
      { path: routes.browser.path.slice(1), element: <FileBrowserPage /> },
      { path: routes.plugins.path.slice(1), element: <PluginManagementPage /> },
      { path: routes.apiAccess.path.slice(1), element: <ApiAccessPage /> },
      { path: routes.settings.path.slice(1), element: <SystemSettingsPage /> },
      { path: '*', element: <Navigate to={routes.tasks.path} replace /> },
    ],
  },
]

export function AppRoutes() {
  return useRoutes(routeDefinitions)
}
