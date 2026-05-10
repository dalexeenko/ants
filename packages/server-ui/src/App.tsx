import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './lib/auth';

export function App() {
  const { user, multiUser, logout, serverVersion } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  const closeSidebar = () => setSidebarOpen(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Build nav items based on auth state
  const navItems = [
    { to: '/projects', label: 'Projects' },
    { to: '/settings', label: 'Settings' },
    { to: '/channels', label: 'Channels' },
    ...(multiUser
      ? [
          { to: '/users', label: 'Users' },
          { to: '/groups', label: 'Groups' },
        ]
      : []),
    { to: '/analytics', label: 'Analytics' },
    { to: '/approvals', label: 'Approvals' },
    { to: '/tasks', label: 'Tasks' },
    { to: '/webhooks', label: 'Webhooks' },
    { to: '/memories', label: 'Knowledge Base' },
    { to: '/docker', label: 'Docker' },
    { to: '/notifications', label: 'Notifications' },
    { to: '/account', label: 'Account' },
  ];

  return (
    <div className="app-layout">
      {/* Mobile toggle */}
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle sidebar"
        data-testid="server-ui-sidebar-toggle"
      >
        &#9776;
      </button>

      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
        onClick={closeSidebar}
      />

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} data-testid="server-ui-sidebar">
        <div className="sidebar-header">
          <NavLink to="/" className="sidebar-logo" onClick={closeSidebar}>
            Ants
          </NavLink>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={closeSidebar}
              data-testid={`server-ui-sidebar-nav-${item.to.replace('/', '')}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {user && (
            <div className="sidebar-user">
              <span className="text-sm text-muted">
                {user.displayName || user.username}
              </span>
              {multiUser && (
                <button className="btn btn-sm" onClick={handleLogout} data-testid="server-ui-signout">
                  Sign Out
                </button>
              )}
            </div>
          )}
          <span className="text-sm text-muted">Ants Server{serverVersion ? ` v${serverVersion}` : ''}</span>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content" data-testid="server-ui-content">
        <div className="page-container">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
