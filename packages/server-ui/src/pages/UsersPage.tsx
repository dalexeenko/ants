import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/* ── Types ────────────────────────────────────────────────────── */

interface UserInfo {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: string;
  enabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/* ── Component ────────────────────────────────────────────────── */

export function UsersPage() {
  const { user: currentUser, multiUser } = useAuth();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create user modal
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState({
    username: '',
    password: '',
    displayName: '',
    email: '',
    role: 'operator' as string,
  });
  const [createLoading, setCreateLoading] = useState(false);

  // Edit user modal
  const [editUser, setEditUser] = useState<UserInfo | null>(null);
  const [editData, setEditData] = useState({
    displayName: '',
    email: '',
    role: '',
    enabled: true,
  });
  const [editLoading, setEditLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const data = await api.get<{ users: UserInfo[] }>('/users');
      setUsers(data.users);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (multiUser) loadUsers();
    else setLoading(false);
  }, [loadUsers, multiUser]);

  const flashStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  if (!multiUser) {
    return (
      <>
        <div className="page-header">
          <h1>User Management</h1>
          <p>Manage users and their permissions</p>
        </div>
        <div className="empty-state">
          <p>Single-user mode</p>
          <p className="empty-hint">
            Enable multi-user mode (ANTS_MULTI_USER=true) to manage users.
          </p>
        </div>
      </>
    );
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    try {
      await api.post('/users', {
        username: createData.username,
        password: createData.password,
        role: createData.role,
        displayName: createData.displayName || undefined,
        email: createData.email || undefined,
      });
      flashStatus('success', `User "${createData.username}" created`);
      setShowCreate(false);
      setCreateData({ username: '', password: '', displayName: '', email: '', role: 'operator' });
      await loadUsers();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreateLoading(false);
    }
  };

  const openEditUser = (u: UserInfo) => {
    setEditUser(u);
    setEditData({
      displayName: u.displayName || '',
      email: u.email || '',
      role: u.role,
      enabled: u.enabled,
    });
  };

  const handleEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditLoading(true);
    try {
      await api.patch(`/users/${editUser.id}`, {
        displayName: editData.displayName || undefined,
        email: editData.email || undefined,
        role: editData.role,
        enabled: editData.enabled,
      });
      flashStatus('success', `User "${editUser.username}" updated`);
      setEditUser(null);
      await loadUsers();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setEditLoading(false);
    }
  };

  const deleteUser = async (u: UserInfo) => {
    if (u.id === currentUser?.id) {
      flashStatus('error', 'Cannot delete your own account');
      return;
    }
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      flashStatus('success', `User "${u.username}" deleted`);
      await loadUsers();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  return (
    <div data-testid="server-ui-users">
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <h1>User Management</h1>
            <p>Manage users and their permissions</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)} data-testid="server-ui-users-create">
            Create User
          </button>
        </div>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>{status.message}</div>
      )}

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          <span>Loading users...</span>
        </div>
      ) : users.length === 0 ? (
        <div className="empty-state">
          <p>No users found</p>
          <p className="empty-hint">Create your first user to get started</p>
        </div>
      ) : (
        <div className="table-container" data-testid="server-ui-users-table">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Display Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong>
                    {u.id === currentUser?.id && (
                      <span className="badge badge-primary" style={{ marginLeft: 4 }}>
                        you
                      </span>
                    )}
                  </td>
                  <td>{u.displayName || '-'}</td>
                  <td>
                    <span
                      className={`badge ${
                        u.role === 'admin'
                          ? 'badge-error'
                          : u.role === 'operator'
                            ? 'badge-primary'
                            : 'badge-default'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${u.enabled ? 'badge-success' : 'badge-warning'}`}>
                      {u.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    {u.lastLoginAt
                      ? new Date(u.lastLoginAt).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn btn-sm" onClick={() => openEditUser(u)}>
                        Edit
                      </button>
                      {u.id !== currentUser?.id && (
                        <button className="btn btn-danger btn-sm" onClick={() => deleteUser(u)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create User Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="server-ui-users-create-modal">
            <h3>Create User</h3>
            <form onSubmit={handleCreate}>
              <div className="input-group">
                <label>Username</label>
                <input
                  type="text"
                  value={createData.username}
                  onChange={(e) => setCreateData((d) => ({ ...d, username: e.target.value }))}
                  required
                  autoFocus
                />
              </div>
              <div className="input-group">
                <label>Password</label>
                <input
                  type="password"
                  value={createData.password}
                  onChange={(e) => setCreateData((d) => ({ ...d, password: e.target.value }))}
                  required
                />
              </div>
              <div className="input-group">
                <label>Display Name</label>
                <input
                  type="text"
                  value={createData.displayName}
                  onChange={(e) => setCreateData((d) => ({ ...d, displayName: e.target.value }))}
                />
              </div>
              <div className="input-group">
                <label>Email</label>
                <input
                  type="email"
                  value={createData.email}
                  onChange={(e) => setCreateData((d) => ({ ...d, email: e.target.value }))}
                />
              </div>
              <div className="input-group">
                <label>Role</label>
                <select
                  value={createData.role}
                  onChange={(e) => setCreateData((d) => ({ ...d, role: e.target.value }))}
                >
                  <option value="viewer">Viewer</option>
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={createLoading}>
                  {createLoading ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit User: {editUser.username}</h3>
            <form onSubmit={handleEdit}>
              <div className="input-group">
                <label>Display Name</label>
                <input
                  type="text"
                  value={editData.displayName}
                  onChange={(e) => setEditData((d) => ({ ...d, displayName: e.target.value }))}
                />
              </div>
              <div className="input-group">
                <label>Email</label>
                <input
                  type="email"
                  value={editData.email}
                  onChange={(e) => setEditData((d) => ({ ...d, email: e.target.value }))}
                />
              </div>
              <div className="input-group">
                <label>Role</label>
                <select
                  value={editData.role}
                  onChange={(e) => setEditData((d) => ({ ...d, role: e.target.value }))}
                >
                  <option value="viewer">Viewer</option>
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="input-group">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={editData.enabled}
                    onChange={(e) => setEditData((d) => ({ ...d, enabled: e.target.checked }))}
                  />
                  <span style={{ marginLeft: 8 }}>Enabled</span>
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setEditUser(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={editLoading}>
                  {editLoading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
