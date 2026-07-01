import { BrowserRouter } from 'react-router-dom'

import { AppProviders } from './providers'
import { AppRoutes } from './routes'
import { AuthProvider } from '../features/auth/AuthProvider'

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </AppProviders>
  )
}

export default App
