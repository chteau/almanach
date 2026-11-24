import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { AppShell } from '../components/AppShell/AppShell.tsx';
import { StatusScreen } from '../components/StatusScreen/StatusScreen.tsx';
import { AuthProvider } from '../features/auth/AuthProvider.tsx';
import { RequireAuth } from '../features/auth/guards.tsx';
import { LoginPage } from '../features/auth/LoginPage.tsx';
import { ClientDetailPage } from '../features/clients/ClientDetailPage.tsx';
import { ClientFormPage } from '../features/clients/ClientFormPage.tsx';
import { ClientImportPage } from '../features/clients/ClientImportPage.tsx';
import { ClientsPage } from '../features/clients/ClientsPage.tsx';
import { DocumentPage } from '../features/documents/DocumentPage.tsx';
import { DocumentsPage } from '../features/documents/DocumentsPage.tsx';
import { PaymentsPage } from '../features/documents/PaymentsPage.tsx';
import { ExpensesPage } from '../features/expenses/ExpensesPage.tsx';
import { InstallPage } from '../features/install/InstallPage.tsx';
import { useInstallStatus } from '../features/install/useInstallStatus.ts';
import { LinkedRecordPage } from '../features/linked/LinkedRecordPage.tsx';
import { MissionDetailPage } from '../features/missions/MissionDetailPage.tsx';
import { MissionFormPage } from '../features/missions/MissionFormPage.tsx';
import { MissionsPage } from '../features/missions/MissionsPage.tsx';
import { OnboardingPage } from '../features/onboarding/OnboardingPage.tsx';
import { CalendarPage } from '../features/planning/CalendarPage.tsx';
import { CustomDeadlinePage } from '../features/planning/CustomDeadlinePage.tsx';
import { DashboardPage } from '../features/planning/DashboardPage.tsx';
import { DeadlinePage } from '../features/planning/DeadlinePage.tsx';
import { MenuPage } from '../features/planning/MenuPage.tsx';
import { NotificationsPage } from '../features/planning/NotificationsPage.tsx';
import { ThresholdsPage } from '../features/planning/ThresholdsPage.tsx';
import { ReviewPage } from '../features/review/ReviewPage.tsx';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';
import { ErrorPage, NotFoundPage } from '../features/system/SystemPages.tsx';
import { TimePage } from '../features/time/TimePage.tsx';

/**
 * Sends every visitor of a fresh instance to the installer before anything else
 *
 * @returns {JSX.Element} - the routed page, a redirect or a status screen
 */
function InstalledGate() {
  const status = useInstallStatus();
  if (status === 'loading' || status === 'error') return <StatusScreen state={status} />;
  if (status === 'not_installed') return <Navigate to="/install" replace />;
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  { path: '/install', element: <InstallPage /> },
  {
    element: <InstalledGate />,
    errorElement: <ErrorPage />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        path: '/onboarding',
        element: (
          <RequireAuth onboarded={false}>
            <OnboardingPage />
          </RequireAuth>
        ),
      },
      {
        element: (
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <DashboardPage /> },
          { path: '/calendar', element: <CalendarPage /> },
          { path: '/calendar/custom/new', element: <CustomDeadlinePage /> },
          { path: '/calendar/custom/:id', element: <CustomDeadlinePage /> },
          { path: '/calendar/:key', element: <DeadlinePage /> },
          { path: '/thresholds', element: <ThresholdsPage /> },
          { path: '/time', element: <TimePage /> },
          { path: '/notifications', element: <NotificationsPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/settings/:section', element: <SettingsPage /> },
          { path: '/menu', element: <MenuPage /> },
          { path: '/clients', element: <ClientsPage /> },
          { path: '/clients/new', element: <ClientFormPage /> },
          { path: '/clients/import', element: <ClientImportPage /> },
          { path: '/clients/:id', element: <ClientDetailPage /> },
          { path: '/clients/:id/edit', element: <ClientFormPage /> },
          { path: '/missions', element: <MissionsPage /> },
          { path: '/missions/new', element: <MissionFormPage /> },
          { path: '/missions/:id', element: <MissionDetailPage /> },
          { path: '/missions/:id/edit', element: <MissionFormPage /> },
          { path: '/quotes', element: <DocumentsPage key="quote" kind="quote" /> },
          { path: '/invoices', element: <DocumentsPage key="invoice" kind="invoice" /> },
          { path: '/credit-notes', element: <DocumentsPage key="credit_note" kind="credit_note" /> },
          { path: '/documents/new', element: <DocumentPage /> },
          { path: '/documents/:id', element: <DocumentPage /> },
          { path: '/payments', element: <PaymentsPage /> },
          { path: '/review', element: <ReviewPage /> },
          { path: '/expenses', element: <ExpensesPage /> },
          { path: '/linked/:kind/:linkId/:id', element: <LinkedRecordPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

/**
 * Application router
 *
 * @returns {JSX.Element} - the router
 */
export function App() {
  return <RouterProvider router={router} />;
}
