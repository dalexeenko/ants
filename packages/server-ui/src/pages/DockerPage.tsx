import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

/* ── Types ────────────────────────────────────────────────────── */

interface DockerStatus {
  available: boolean;
  version?: string;
  platform: string;
}

interface AgentImageInfo {
  image: string;
  source: 'env' | 'introspection' | 'default';
  exists: boolean;
}

interface ContainerInfo {
  containerId: string;
  containerName: string;
  status: string;
  port?: number;
  image: string;
  workingDirectory: string;
  createdAt?: string;
}

const SOURCE_LABELS: Record<AgentImageInfo['source'], string> = {
  env: 'OPENMGR_IMAGE env var',
  introspection: 'Docker introspection',
  default: 'Default',
};

/* ── Component ────────────────────────────────────────────────── */

export function DockerPage() {
  const [status, setStatus] = useState<DockerStatus | null>(null);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [imageInfo, setImageInfo] = useState<AgentImageInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [dockerStatus, containerData, agentImage] = await Promise.all([
        api.get<DockerStatus>('/docker/status').catch(() => null),
        api.get<ContainerInfo[]>('/docker/containers').catch(() => []),
        api.get<AgentImageInfo>('/docker/agent-image').catch(() => null),
      ]);
      if (dockerStatus) setStatus(dockerStatus);
      setContainers(Array.isArray(containerData) ? containerData : []);
      if (agentImage) setImageInfo(agentImage);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1>Docker</h1>
          <p>Docker container management</p>
        </div>
        <div className="loading">
          <div className="spinner" />
          <span>Loading Docker status...</span>
        </div>
      </>
    );
  }

  return (
    <div data-testid="server-ui-docker">
      <div className="page-header">
        <h1>Docker</h1>
        <p>Docker container management</p>
      </div>

      {/* Docker Status */}
      <div className="section" data-testid="server-ui-docker-status">
        <h2 className="section-header">Status</h2>
        <div className="card">
          <div className="card-row">
            <div className="card-info">
              <strong>Docker</strong>
              <span className="text-muted">
                {status?.available ? (
                  <span className="badge badge-success">Available</span>
                ) : (
                  <span className="badge badge-warning">Not Available</span>
                )}
              </span>
            </div>
          </div>
          {status?.version && (
            <div className="card-row">
              <div className="card-info">
                <strong>Version</strong>
                <span className="text-muted">{status.version}</span>
              </div>
            </div>
          )}
          {status?.platform && (
            <div className="card-row">
              <div className="card-info">
                <strong>Platform</strong>
                <span className="text-muted">{status.platform}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Agent Image */}
      {status?.available && imageInfo && (
        <div className="section">
          <h2 className="section-header">Agent Image</h2>
          <div className="card">
            <div className="card-row">
              <div className="card-info">
                <strong>Image</strong>
                <span className="text-muted" style={{ fontFamily: 'monospace' }}>
                  {imageInfo.image}
                </span>
              </div>
            </div>
            <div className="card-row">
              <div className="card-info">
                <strong>Source</strong>
                <span className="text-muted">{SOURCE_LABELS[imageInfo.source]}</span>
              </div>
            </div>
            <div className="card-row">
              <div className="card-info">
                <strong>Status</strong>
                <span className="text-muted">
                  {imageInfo.exists ? (
                    <span className="badge badge-success">Available</span>
                  ) : (
                    <span className="badge badge-warning">Not Found</span>
                  )}
                </span>
              </div>
            </div>
            {!imageInfo.exists && (
              <div className="card-row">
                <div className="card-info">
                  <span className="text-muted">
                    Pull the image with: <code>docker pull {imageInfo.image}</code>
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Running Containers */}
      {status?.available && (
        <div className="section">
          <h2 className="section-header">Running Containers</h2>
          {containers.length > 0 ? (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Working Directory</th>
                    <th>Container ID</th>
                    <th>Image</th>
                    <th>Status</th>
                    <th>Port</th>
                  </tr>
                </thead>
                <tbody>
                  {containers.map((c) => (
                    <tr key={c.containerId}>
                      <td>{c.workingDirectory}</td>
                      <td className="text-muted">{c.containerId}</td>
                      <td className="text-muted">{c.image}</td>
                      <td>
                        <span className={`badge badge-${c.status === 'running' ? 'success' : 'warning'}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="text-muted">{c.port || '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <p>No running containers</p>
            </div>
          )}
        </div>
      )}

      {/* Docker Not Available */}
      {!status?.available && (
        <div className="section">
          <div className="empty-state">
            <p>Docker is not available on this server</p>
            <p className="empty-hint">
              Install Docker and ensure it is running to use containerized agent environments.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
