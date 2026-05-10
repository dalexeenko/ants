import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

interface ProjectConfig {
  id: string;
  name: string;
  workingDirectory: string;
  autoStart?: boolean;
  defaultModel?: string;
  createdAt: string;
  updatedAt?: string;
  serverPort?: number;
  serverPid?: number;
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const flashStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  const loadProjects = useCallback(async () => {
    try {
      const data = await api.get<{ projects: ProjectConfig[] }>('/projects');
      setProjects(data.projects);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleDelete = async (project: ProjectConfig) => {
    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/projects/${project.id}`);
      flashStatus('success', `Project "${project.name}" deleted`);
      await loadProjects();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1>Projects</h1>
          <p>Manage agent projects</p>
        </div>
        <div className="loading">
          <div className="spinner" />
          <span>Loading projects...</span>
        </div>
      </>
    );
  }

  return (
    <div data-testid="server-ui-projects">
      <div className="page-header">
        <h1>Projects</h1>
        <p>Manage agent projects</p>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>{status.message}</div>
      )}

      {projects.length > 0 ? (
        <div className="section">
          <div className="card" data-testid="server-ui-projects-list">
            {projects.map((project) => (
              <div className="card-row" key={project.id} data-testid={`server-ui-project-card-${project.id}`}>
                <div className="card-info">
                  <strong>{project.name}</strong>
                  <span className="text-muted text-sm">{project.workingDirectory}</span>
                  <div className="flex gap-2" style={{ marginTop: 2 }}>
                    {project.serverPort ? (
                      <span className="badge badge-success">Running on :{project.serverPort}</span>
                    ) : (
                      <span className="badge badge-default">Stopped</span>
                    )}
                    {project.autoStart && (
                      <span className="badge badge-primary">Auto-start</span>
                    )}
                    {project.defaultModel && (
                      <span className="badge badge-default">{project.defaultModel}</span>
                    )}
                  </div>
                </div>
                <div className="card-actions">
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDelete(project)}
                    data-testid={`server-ui-project-delete-${project.id}`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="section">
          <div className="empty-state" data-testid="server-ui-projects-empty">
            <p>No projects</p>
          </div>
        </div>
      )}
    </div>
  );
}
