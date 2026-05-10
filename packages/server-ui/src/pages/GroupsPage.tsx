import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/* ── Types ────────────────────────────────────────────────────── */

interface Group {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  username?: string;
  displayName?: string;
  joinedAt: string;
}

interface GroupProjectAccess {
  id: string;
  groupId: string;
  projectId: string;
  role: string;
}

/* ── Component ────────────────────────────────────────────────── */

export function GroupsPage() {
  const { multiUser } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create group modal
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState({ name: '', description: '' });
  const [createLoading, setCreateLoading] = useState(false);

  // Detail panel
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [projectAccess, setProjectAccess] = useState<GroupProjectAccess[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Add member
  const [addMemberUserId, setAddMemberUserId] = useState('');
  const [addMemberLoading, setAddMemberLoading] = useState(false);

  // Add project access
  const [addProjectId, setAddProjectId] = useState('');
  const [addProjectRole, setAddProjectRole] = useState('operator');
  const [addProjectLoading, setAddProjectLoading] = useState(false);

  const loadGroups = useCallback(async () => {
    try {
      const data = await api.get<{ groups: Group[] }>('/groups');
      setGroups(data.groups);
    } catch (err) {
      console.error('Failed to load groups:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (multiUser) loadGroups();
    else setLoading(false);
  }, [loadGroups, multiUser]);

  const flashStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  const loadGroupDetail = async (group: Group) => {
    setSelectedGroup(group);
    setDetailLoading(true);
    try {
      const [membersRes, accessRes] = await Promise.all([
        api.get<{ members: GroupMember[] }>(`/groups/${group.id}/members`),
        api.get<{ projectAccess: GroupProjectAccess[] }>(`/groups/${group.id}/projects`),
      ]);
      setMembers(membersRes.members);
      setProjectAccess(accessRes.projectAccess);
    } catch (err) {
      console.error('Failed to load group details:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  if (!multiUser) {
    return (
      <>
        <div className="page-header">
          <h1>Group Management</h1>
          <p>Organize users into groups with shared permissions</p>
        </div>
        <div className="empty-state">
          <p>Single-user mode</p>
          <p className="empty-hint">
            Enable multi-user mode (ANTS_MULTI_USER=true) to manage groups.
          </p>
        </div>
      </>
    );
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    try {
      await api.post('/groups', {
        name: createData.name,
        description: createData.description || undefined,
      });
      flashStatus('success', `Group "${createData.name}" created`);
      setShowCreate(false);
      setCreateData({ name: '', description: '' });
      await loadGroups();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setCreateLoading(false);
    }
  };

  const deleteGroup = async (group: Group) => {
    if (!confirm(`Delete group "${group.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/groups/${group.id}`);
      flashStatus('success', `Group "${group.name}" deleted`);
      if (selectedGroup?.id === group.id) setSelectedGroup(null);
      await loadGroups();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to delete group');
    }
  };

  const addMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedGroup || !addMemberUserId.trim()) return;
    setAddMemberLoading(true);
    try {
      await api.post(`/groups/${selectedGroup.id}/members`, {
        userId: addMemberUserId.trim(),
      });
      flashStatus('success', 'Member added');
      setAddMemberUserId('');
      await loadGroupDetail(selectedGroup);
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setAddMemberLoading(false);
    }
  };

  const removeMember = async (userId: string) => {
    if (!selectedGroup) return;
    try {
      await api.delete(`/groups/${selectedGroup.id}/members/${userId}`);
      flashStatus('success', 'Member removed');
      await loadGroupDetail(selectedGroup);
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  const addProjectAccessEntry = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedGroup || !addProjectId.trim()) return;
    setAddProjectLoading(true);
    try {
      await api.put(`/groups/${selectedGroup.id}/projects/${addProjectId.trim()}`, {
        role: addProjectRole,
      });
      flashStatus('success', 'Project access added');
      setAddProjectId('');
      await loadGroupDetail(selectedGroup);
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to add project access');
    } finally {
      setAddProjectLoading(false);
    }
  };

  const removeProjectAccess = async (projectId: string) => {
    if (!selectedGroup) return;
    try {
      await api.delete(`/groups/${selectedGroup.id}/projects/${projectId}`);
      flashStatus('success', 'Project access removed');
      await loadGroupDetail(selectedGroup);
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to remove access');
    }
  };

  return (
    <div data-testid="server-ui-groups">
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <h1>Group Management</h1>
            <p>Organize users into groups with shared permissions</p>
          </div>
          <button data-testid="server-ui-groups-create" className="btn btn-primary" onClick={() => setShowCreate(true)}>
            Create Group
          </button>
        </div>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>{status.message}</div>
      )}

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          <span>Loading groups...</span>
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-state">
          <p>No groups yet</p>
          <p className="empty-hint">Create groups to assign shared project access</p>
        </div>
      ) : (
        <div className="card">
          {groups.map((g) => (
            <div className="card-row" key={g.id}>
              <div
                className="card-info"
                style={{ cursor: 'pointer' }}
                onClick={() => loadGroupDetail(g)}
              >
                <strong>{g.name}</strong>
                <span className="text-muted">{g.description || 'No description'}</span>
              </div>
              <div className="card-actions">
                <button className="btn btn-sm" onClick={() => loadGroupDetail(g)}>
                  Details
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => deleteGroup(g)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Group Detail Panel */}
      {selectedGroup && (
        <div className="section mt-4">
          <h2 className="section-header">{selectedGroup.name}</h2>
          {selectedGroup.description && (
            <p className="section-description">{selectedGroup.description}</p>
          )}

          {detailLoading ? (
            <div className="loading">
              <div className="spinner" />
            </div>
          ) : (
            <>
              {/* Members */}
              <div className="mt-3">
                <h3>Members ({members.length})</h3>
                {members.length > 0 ? (
                  <div className="card mt-1">
                    {members.map((m) => (
                      <div className="card-row" key={m.id}>
                        <div className="card-info">
                          <strong>{m.displayName || m.userId}</strong>
                          <span className="text-muted">{m.username || m.userId}</span>
                        </div>
                        <div className="card-actions">
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => removeMember(m.userId)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted mt-1">No members</p>
                )}
                <form className="flex gap-2 mt-2" onSubmit={addMember}>
                  <input
                    type="text"
                    placeholder="User ID"
                    value={addMemberUserId}
                    onChange={(e) => setAddMemberUserId(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={addMemberLoading || !addMemberUserId.trim()}
                  >
                    {addMemberLoading ? 'Adding...' : 'Add Member'}
                  </button>
                </form>
              </div>

              {/* Project Access */}
              <div className="mt-3">
                <h3>Project Access ({projectAccess.length})</h3>
                {projectAccess.length > 0 ? (
                  <div className="card mt-1">
                    {projectAccess.map((pa) => (
                      <div className="card-row" key={pa.id}>
                        <div className="card-info">
                          <strong>{pa.projectId}</strong>
                          <span className="text-muted">
                            <span
                              className={`badge ${
                                pa.role === 'admin'
                                  ? 'badge-error'
                                  : pa.role === 'operator'
                                    ? 'badge-primary'
                                    : 'badge-default'
                              }`}
                            >
                              {pa.role}
                            </span>
                          </span>
                        </div>
                        <div className="card-actions">
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => removeProjectAccess(pa.projectId)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted mt-1">No project access</p>
                )}
                <form className="flex gap-2 mt-2" onSubmit={addProjectAccessEntry}>
                  <input
                    type="text"
                    placeholder="Project ID"
                    value={addProjectId}
                    onChange={(e) => setAddProjectId(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <select
                    value={addProjectRole}
                    onChange={(e) => setAddProjectRole(e.target.value)}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={addProjectLoading || !addProjectId.trim()}
                  >
                    {addProjectLoading ? 'Adding...' : 'Add Access'}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      )}

      {/* Create Group Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create Group</h3>
            <form onSubmit={handleCreate}>
              <div className="input-group">
                <label>Name</label>
                <input
                  type="text"
                  value={createData.name}
                  onChange={(e) => setCreateData((d) => ({ ...d, name: e.target.value }))}
                  required
                  autoFocus
                />
              </div>
              <div className="input-group">
                <label>Description</label>
                <input
                  type="text"
                  value={createData.description}
                  onChange={(e) => setCreateData((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Optional description"
                />
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
    </div>
  );
}
