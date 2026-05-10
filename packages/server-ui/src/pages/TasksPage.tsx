import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useProjects } from '../lib/useProjects';

/* ── Types ────────────────────────────────────────────────────── */

interface TaskRun {
  id: string;
  status: 'success' | 'error' | 'running';
  sessionId?: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  cronSchedule: string;
  enabled: boolean;
  sessionMode: 'new' | 'dedicated';
  model?: string;
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'error' | 'running';
  runHistory?: TaskRun[];
}

/* ── Component ────────────────────────────────────────────────── */

export function TasksPage() {
  const { projects, selectedProjectId, setSelectedProjectId, loading: projectsLoading } = useProjects();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  // Create task state
  const [showCreate, setShowCreate] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [taskCron, setTaskCron] = useState('');
  const [taskSessionMode, setTaskSessionMode] = useState<'new' | 'dedicated'>('new');
  const [createLoading, setCreateLoading] = useState(false);

  // Run state
  const [runLoading, setRunLoading] = useState<string | null>(null);

  const flashStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  const loadTasks = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const data = await api.get<{ tasks: ScheduledTask[] }>(`/${selectedProjectId}/tasks`);
      setTasks(data.tasks);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setCreateLoading(true);
    try {
      await api.post(`/${selectedProjectId}/tasks`, {
        name: taskName.trim(),
        prompt: taskPrompt.trim(),
        cronSchedule: taskCron.trim(),
        sessionMode: taskSessionMode,
        enabled: true,
      });
      flashStatus('success', 'Task created');
      setShowCreate(false);
      setTaskName('');
      setTaskPrompt('');
      setTaskCron('');
      setTaskSessionMode('new');
      await loadTasks();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!selectedProjectId) return;
    try {
      await api.delete(`/${selectedProjectId}/tasks/${id}`);
      flashStatus('success', 'Task deleted');
      await loadTasks();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to delete task');
    }
  };

  const handleToggle = async (task: ScheduledTask) => {
    if (!selectedProjectId) return;
    try {
      await api.patch(`/${selectedProjectId}/tasks/${task.id}`, { enabled: !task.enabled });
      await loadTasks();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to update task');
    }
  };

  const handleRun = async (id: string) => {
    if (!selectedProjectId) return;
    setRunLoading(id);
    try {
      await api.post(`/${selectedProjectId}/tasks/${id}/run`);
      flashStatus('success', 'Task triggered');
      await loadTasks();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to trigger task');
    } finally {
      setRunLoading(null);
    }
  };

  if (projectsLoading) {
    return (
      <>
        <div className="page-header">
          <h1>Scheduled Tasks</h1>
          <p>Manage automated task schedules</p>
        </div>
        <div className="loading">
          <div className="spinner" />
          <span>Loading...</span>
        </div>
      </>
    );
  }

  return (
    <div data-testid="server-ui-tasks">
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <h1>Scheduled Tasks</h1>
            <p>Manage automated task schedules</p>
          </div>
          {selectedProjectId && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)} data-testid="server-ui-tasks-add">
              Add Task
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
          <p className="empty-hint">Create a project first to schedule tasks.</p>
        </div>
      )}

      {/* Task List */}
      {selectedProjectId && (
        <div className="section">
          {loading ? (
            <div className="loading">
              <div className="spinner" />
              <span>Loading tasks...</span>
            </div>
          ) : tasks.length > 0 ? (
            <div className="card">
              {tasks.map((task) => (
                <div key={task.id}>
                  <div className="card-row">
                    <div className="card-info" style={{ cursor: 'pointer' }} onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}>
                      <strong>{task.name}</strong>
                      <span className="text-muted text-sm">
                        <code>{task.cronSchedule}</code>
                        {' · '}{task.sessionMode}
                        {task.lastRunStatus && (
                          <>
                            {' · Last: '}
                            <span className={`badge badge-${task.lastRunStatus === 'success' ? 'success' : task.lastRunStatus === 'error' ? 'error' : 'warning'}`}>
                              {task.lastRunStatus}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                    <div className="card-actions">
                      <button
                        className="btn btn-sm"
                        onClick={() => handleRun(task.id)}
                        disabled={runLoading !== null}
                        data-testid={`server-ui-task-run-${task.id}`}
                      >
                        {runLoading === task.id ? 'Running...' : 'Run Now'}
                      </button>
                      <label className="toggle-label">
                        <input
                          type="checkbox"
                          checked={task.enabled}
                          onChange={() => handleToggle(task)}
                          data-testid={`server-ui-task-toggle-${task.id}`}
                        />
                      </label>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDelete(task.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Expanded: show prompt and run history */}
                  {expandedTask === task.id && (
                    <div style={{ padding: '0 1rem 1rem', borderBottom: '1px solid var(--border-light)' }}>
                      <p className="text-sm" style={{ margin: '0 0 0.5rem' }}>
                        <strong>Prompt:</strong> {task.prompt}
                      </p>
                      {task.runHistory && task.runHistory.length > 0 && (
                        <div className="table-container">
                          <table>
                            <thead>
                              <tr>
                                <th>Status</th>
                                <th>Started</th>
                                <th>Finished</th>
                                <th>Error</th>
                              </tr>
                            </thead>
                            <tbody>
                              {task.runHistory.slice(0, 10).map((run) => (
                                <tr key={run.id}>
                                  <td>
                                    <span className={`badge badge-${run.status === 'success' ? 'success' : run.status === 'error' ? 'error' : 'warning'}`}>
                                      {run.status}
                                    </span>
                                  </td>
                                  <td className="text-muted">{new Date(run.startedAt).toLocaleString()}</td>
                                  <td className="text-muted">{run.finishedAt ? new Date(run.finishedAt).toLocaleString() : '—'}</td>
                                  <td className="text-muted">{run.error || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p>No scheduled tasks</p>
              <p className="empty-hint">Create a task to run agent prompts on a cron schedule.</p>
            </div>
          )}
        </div>
      )}

      {/* Create Task Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" data-testid="server-ui-tasks-create-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Scheduled Task</h3>
            <form onSubmit={handleCreate}>
              <div className="input-group">
                <label>Name <span className="text-error">*</span></label>
                <input
                  type="text"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="e.g., Daily code review"
                  required
                  autoFocus
                />
              </div>
              <div className="input-group">
                <label>Prompt <span className="text-error">*</span></label>
                <textarea
                  value={taskPrompt}
                  onChange={(e) => setTaskPrompt(e.target.value)}
                  placeholder="The prompt to send to the agent..."
                  required
                  rows={3}
                />
              </div>
              <div className="input-group">
                <label>Cron Schedule <span className="text-error">*</span></label>
                <input
                  type="text"
                  value={taskCron}
                  onChange={(e) => setTaskCron(e.target.value)}
                  placeholder="e.g., 0 9 * * * (daily at 9am)"
                  required
                />
                <span className="text-muted text-sm" style={{ display: 'block', marginTop: '0.25rem' }}>
                  Standard cron expression (minute hour day month weekday)
                </span>
              </div>
              <div className="input-group">
                <label>Session Mode</label>
                <select
                  value={taskSessionMode}
                  onChange={(e) => setTaskSessionMode(e.target.value as 'new' | 'dedicated')}
                >
                  <option value="new">New session each run</option>
                  <option value="dedicated">Dedicated session (reuse)</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createLoading || !taskName.trim() || !taskPrompt.trim() || !taskCron.trim()}
                >
                  {createLoading ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
