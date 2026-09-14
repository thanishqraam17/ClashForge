import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { OverviewPage } from '@/pages/OverviewPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'

export default function App(): React.JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route
            path="scan"
            element={
              <PlaceholderPage
                title="Scan Village"
                description="Screenshot capture and OCR review will be available in a later phase."
              />
            }
          />
          <Route
            path="upgrades"
            element={
              <PlaceholderPage
                title="Upgrades"
                description="Builder recommendations and upgrade tracking will be available in a later phase."
              />
            }
          />
          <Route
            path="history"
            element={
              <PlaceholderPage
                title="History"
                description="Upgrade history will be available in a later phase."
              />
            }
          />
          <Route
            path="settings"
            element={
              <PlaceholderPage
                title="Settings"
                description="Theme, data export, and about information will be available in a later phase."
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
