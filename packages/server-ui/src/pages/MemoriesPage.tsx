import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useProjects } from '../lib/useProjects';

/* ── Types ────────────────────────────────────────────────────── */

interface MemoryItem {
  id: string;
  content: string;
  scope: string;
  tags: string[];
  author?: string;
  createdAt: string;
  updatedAt: string;
  hasEmbedding?: boolean;
}

interface MemoryStatus {
  available: boolean;
  memoriesWithEmbeddings: number;
  totalMemories: number;
}

/* ── Component ────────────────────────────────────────────────── */

export function MemoriesPage() {
  const { projects, selectedProjectId, setSelectedProjectId, loading: projectsLoading } = useProjects();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create memory state
  const [showCreate, setShowCreate] = useState(false);
  const [createContent, setCreateContent] = useState('');
  const [createScope, setCreateScope] = useState('');
  const [createTags, setCreateTags] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const flashStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  const loadMemories = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const endpoint = searchQuery.trim()
        ? `/${selectedProjectId}/memories/search?query=${encodeURIComponent(searchQuery.trim())}&limit=50`
        : `/${selectedProjectId}/memories?limit=50`;

      if (searchQuery.trim()) {
        const data = await api.get<{ results: Array<{ memory: MemoryItem }> }>(endpoint);
        setMemories(data.results.map((r) => r.memory));
        setTotal(data.results.length);
      } else {
        const data = await api.get<{ memories: MemoryItem[]; total: number }>(endpoint);
        setMemories(data.memories);
        setTotal(data.total);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId, searchQuery]);

  const loadStatus = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const data = await api.get<MemoryStatus>(`/${selectedProjectId}/memories/status`);
      setMemoryStatus(data);
    } catch {
      // ignore
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadMemories();
    loadStatus();
  }, [loadMemories, loadStatus]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setCreateLoading(true);
    try {
      await api.post(`/${selectedProjectId}/memories`, {
        content: createContent.trim(),
        scope: createScope.trim() || undefined,
        tags: createTags.trim() ? createTags.split(',').map((t) => t.trim()) : undefined,
      });
      flashStatus('success', 'Memory created');
      setShowCreate(false);
      setCreateContent('');
      setCreateScope('');
      setCreateTags('');
      await loadMemories();
      await loadStatus();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to create memory');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!selectedProjectId) return;
    try {
      await api.delete(`/${selectedProjectId}/memories/${id}`);
      flashStatus('success', 'Memory deleted');
      await loadMemories();
      await loadStatus();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to delete memory');
    }
  };

  if (projectsLoading) {
    return (
      <>
        <div className="page-header">
          <h1>Knowledge Base</h1>
          <p>Manage agent memories and knowledge</p>
        </div>
        <div className="loading">
          <div className="spinner" />
          <span>Loading...</span>
        </div>
      </>
    );
  }

  return (
    <>
    <div data-testid="server-ui-memories">
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <h1>Knowledge Base</h1>
            <p>Manage agent memories and knowledge</p>
          </div>
          {selectedProjectId && (
            <button data-testid="server-ui-memories-add" className="btn btn-primary" onClick={() => setShowCreate(true)}>
              Add Memory
            </button>
          )}
        </div>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>{status.message}</div>
      )}

      {/* Project Selector */}
      {projects.length > 0 ? (
        <div className="section">
          <div className="input-group" style={{ maxWidth: '400px' }}>
            <label>Project</label>
            <select
              value={selectedProjectId || ''}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <p>No projects found</p>
          <p className="empty-hint">Create a project first to manage its knowledge base.</p>
        </div>
      )}

      {/* Search */}
      {selectedProjectId && (
        <div className="section">
          <div className="input-group" style={{ maxWidth: '400px' }}>
            <input
              data-testid="server-ui-memories-search"
              type="text"
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Status */}
      {memoryStatus && selectedProjectId && (
        <div className="section">
          <div className="stats-grid">
            <div className="card">
              <div className="card-row">
                <div className="card-info">
                  <strong>Total Memories</strong>
                  <span className="text-muted">{memoryStatus.totalMemories}</span>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-row">
                <div className="card-info">
                  <strong>With Embeddings</strong>
                  <span className="text-muted">{memoryStatus.memoriesWithEmbeddings}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Memory List */}
      {selectedProjectId && (
        <div className="section">
          {loading ? (
            <div className="loading">
              <div className="spinner" />
              <span>Loading memories...</span>
            </div>
          ) : memories.length > 0 ? (
            <>
              <p className="text-muted text-sm" style={{ marginBottom: '0.5rem' }}>
                Showing {memories.length} of {total} memories
              </p>
              <div className="card" data-testid="server-ui-memories-list">
                {memories.map((mem) => (
                  <div className="card-row" key={mem.id}>
                    <div className="card-info" style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                        {mem.content.slice(0, 120)}{mem.content.length > 120 ? '...' : ''}
                      </strong>
                      <span className="text-muted text-sm">
                        {mem.scope && <span className="badge">{mem.scope}</span>}
                        {mem.tags.map((t) => (
                          <span className="badge" key={t} style={{ marginLeft: '0.25rem' }}>{t}</span>
                        ))}
                        {' · '}{new Date(mem.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="card-actions">
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDelete(mem.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p>{searchQuery ? 'No memories match your search' : 'No memories yet'}</p>
              <p className="empty-hint">
                {searchQuery ? 'Try a different search term.' : 'Add memories to build the agent\'s knowledge base.'}
              </p>
            </div>
          )}
        </div>
      )}

      </div>

      {/* Create Memory Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" data-testid="server-ui-memories-create-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Memory</h3>
            <form onSubmit={handleCreate}>
              <div className="input-group">
                <label>Content <span className="text-error">*</span></label>
                <textarea
                  value={createContent}
                  onChange={(e) => setCreateContent(e.target.value)}
                  placeholder="The knowledge or fact to remember..."
                  required
                  rows={4}
                  autoFocus
                />
              </div>
              <div className="input-group">
                <label>Scope</label>
                <input
                  type="text"
                  value={createScope}
                  onChange={(e) => setCreateScope(e.target.value)}
                  placeholder="e.g., project, global"
                />
              </div>
              <div className="input-group">
                <label>Tags</label>
                <input
                  type="text"
                  value={createTags}
                  onChange={(e) => setCreateTags(e.target.value)}
                  placeholder="Comma-separated, e.g., coding, architecture"
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createLoading || !createContent.trim()}
                >
                  {createLoading ? 'Creating...' : 'Create Memory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

