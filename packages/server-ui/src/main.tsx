import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { AuthLayout } from './lib/auth';
import { App } from './App';
import { RouteErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { SettingsPage } from './pages/SettingsPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { ChannelDetailPage } from './pages/ChannelDetailPage';
import { UsersPage } from './pages/UsersPage';
import { GroupsPage } from './pages/GroupsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { AccountPage } from './pages/AccountPage';
import { ConnectPage } from './pages/ConnectPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { DockerPage } from './pages/DockerPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { MemoriesPage } from './pages/MemoriesPage';
import { TasksPage } from './pages/TasksPage';
import { WebhooksPage } from './pages/WebhooksPage';
import { ProjectsPage } from './pages/ProjectsPage';
import './styles.css';

const router = createBrowserRouter([
  {
    // AuthLayout provides AuthProvider + redirect guards for all routes
    element: <AuthLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: '/login',
        element: <LoginPage />,
      },
      {
        path: '/setup',
        element: <SetupPage />,
      },
      {
        path: '/connect',
        element: <ConnectPage />,
      },
      {
        path: '/',
        element: <App />,
        errorElement: <RouteErrorBoundary />,
        children: [
          { index: true, element: <SettingsPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: 'channels', element: <ChannelsPage /> },
          { path: 'channels/:id', element: <ChannelDetailPage /> },
          { path: 'users', element: <UsersPage /> },
          { path: 'groups', element: <GroupsPage /> },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'analytics', element: <AnalyticsPage /> },
          { path: 'docker', element: <DockerPage /> },
          { path: 'approvals', element: <ApprovalsPage /> },
          { path: 'memories', element: <MemoriesPage /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'webhooks', element: <WebhooksPage /> },
          { path: 'account', element: <AccountPage /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
