import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { api } from '../lib/api';

/* ── Types ────────────────────────────────────────────────────── */

interface ApprovalRule {
  id: string;
  projectId: string | null;
  name: string;
  description: string | null;
  toolPattern: string;
  argPatterns: Record<string, string> | null;
  action: 'require_approval' | 'dry_run' | 'block';
  priority: number;
  enabled: boolean;
  isDefault?: boolean;
}

interface ApprovalRequest {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  sessionId: string | null;
  projectId: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'auto_approved';
  createdAt: string;
  expiresAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  note: string | null;
}

/* ── Component ────────────────────────────────────────────────── */

export function ApprovalsPage() {
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'requests' | 'rules'>('requests');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create rule state
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleToolPattern, setRuleToolPattern] = useState('');
  const [ruleAction, setRuleAction] = useState<'require_approval' | 'dry_run' | 'block'>('require_approval');
  const [ruleDescription, setRuleDescription] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // Review state
  const [reviewNote, setReviewNote] = useState('');
  const [reviewLoading, setReviewLoading] = useState<string | null>(null);

  const flashStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  const loadData = useCallback(async () => {
    try {
      const [rulesData, requestsData] = await Promise.all([
        api.get<{ rules: ApprovalRule[] }>('/approvals/rules'),
        api.get<{ requests: ApprovalRequest[] }>('/approvals/requests'),
      ]);
      setRules(rulesData.rules);
      setRequests(requestsData.requests);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateRule = async (e: FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    try {
      await api.post('/approvals/rules', {
        name: ruleName.trim(),
        toolPattern: ruleToolPattern.trim(),
        action: ruleAction,
        description: ruleDescription.trim() || undefined,
        priority: 0,
        enabled: true,
      });
      flashStatus('success', 'Rule created');
      setShowCreateRule(false);
      setRuleName('');
      setRuleToolPattern('');
      setRuleAction('require_approval');
      setRuleDescription('');
      await loadData();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to create rule');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await api.delete(`/approvals/rules/${id}`);
      flashStatus('success', 'Rule deleted');
      await loadData();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to delete rule');
    }
  };

  const handleToggleRule = async (rule: ApprovalRule) => {
    try {
      await api.patch(`/approvals/rules/${rule.id}`, { enabled: !rule.enabled });
      await loadData();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to update rule');
    }
  };

  const handleReview = async (id: string, action: 'approve' | 'deny') => {
    setReviewLoading(id);
    try {
      await api.post(`/approvals/requests/${id}/${action}`, {
        note: reviewNote.trim() || undefined,
      });
      flashStatus('success', `Request ${action === 'approve' ? 'approved' : 'denied'}`);
      setReviewNote('');
      await loadData();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setReviewLoading(null);
    }
  };

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const pastRequests = requests.filter((r) => r.status !== 'pending');

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1>Approvals</h1>
          <p>Human-in-the-loop approval workflows</p>
        </div>
        <div className="loading">
          <div className="spinner" />
          <span>Loading approvals...</span>
        </div>
      </>
    );
  }

  return (
    <div data-testid="server-ui-approvals">
      <div className="page-header">
        <h1>Approvals</h1>
        <p>Human-in-the-loop approval workflows</p>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>{status.message}</div>
      )}

      {/* Tabs */}
      <div className="tabs" data-testid="server-ui-approvals-tabs">
        <button
          className={`tab ${activeTab === 'requests' ? 'active' : ''}`}
          onClick={() => setActiveTab('requests')}
        >
          Requests{pendingRequests.length > 0 ? ` (${pendingRequests.length} pending)` : ''}
        </button>
        <button
          className={`tab ${activeTab === 'rules' ? 'active' : ''}`}
          onClick={() => setActiveTab('rules')}
        >
          Rules ({rules.length})
        </button>
      </div>

      {/* Requests Tab */}
      {activeTab === 'requests' && (
        <>
          {/* Pending Requests */}
          {pendingRequests.length > 0 && (
            <div className="section">
              <h2 className="section-header">Pending Approval</h2>
              <div className="card">
                {pendingRequests.map((req) => (
                  <div className="card-row" key={req.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
                    <div className="flex justify-between items-center">
                      <div className="card-info">
                        <strong>{req.toolName}</strong>
                        <span className="text-muted text-sm">
                          {new Date(req.createdAt).toLocaleString()}
                          {req.sessionId && ` · Session ${req.sessionId.slice(0, 8)}`}
                        </span>
                      </div>
                      <span className="badge badge-warning">Pending</span>
                    </div>
                    {req.arguments && Object.keys(req.arguments).length > 0 && (
                      <pre className="text-sm text-muted" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {JSON.stringify(req.arguments, null, 2)}
                      </pre>
                    )}
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        placeholder="Note (optional)"
                        value={req.id === reviewLoading ? reviewNote : ''}
                        onChange={(e) => setReviewNote(e.target.value)}
                        className="input-sm"
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleReview(req.id, 'approve')}
                        disabled={reviewLoading !== null}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleReview(req.id, 'deny')}
                        disabled={reviewLoading !== null}
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Past Requests */}
          <div className="section">
            <h2 className="section-header">History</h2>
            {pastRequests.length > 0 ? (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Status</th>
                      <th>Requested</th>
                      <th>Reviewed</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastRequests.map((req) => (
                      <tr key={req.id}>
                        <td><strong>{req.toolName}</strong></td>
                        <td>
                          <span className={`badge badge-${req.status === 'approved' ? 'success' : req.status === 'denied' ? 'error' : 'warning'}`}>
                            {req.status}
                          </span>
                        </td>
                        <td className="text-muted">{new Date(req.createdAt).toLocaleString()}</td>
                        <td className="text-muted">
                          {req.reviewedAt ? new Date(req.reviewedAt).toLocaleString() : '—'}
                        </td>
                        <td className="text-muted">{req.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <p>No approval history</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Rules Tab */}
      {activeTab === 'rules' && (
        <div className="section">
          <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
            <h2 className="section-header" style={{ margin: 0 }}>Approval Rules</h2>
            <button className="btn btn-primary btn-sm" data-testid="server-ui-approvals-add-rule" onClick={() => setShowCreateRule(true)}>
              Add Rule
            </button>
          </div>

          {rules.length > 0 ? (
            <div className="card">
              {rules.map((rule) => (
                <div className="card-row" key={rule.id}>
                  <div className="card-info">
                    <strong>{rule.name}</strong>
                    <span className="text-muted text-sm">
                      Pattern: <code>{rule.toolPattern}</code> · Action: {rule.action}
                      {rule.description && ` · ${rule.description}`}
                    </span>
                  </div>
                  <div className="card-actions">
                    <label className="toggle-label">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => handleToggleRule(rule)}
                      />
                    </label>
                    {!rule.isDefault && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDeleteRule(rule.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p>No approval rules configured</p>
              <p className="empty-hint">Add a rule to require human approval before specific tools execute.</p>
            </div>
          )}
        </div>
      )}

      {/* Create Rule Modal */}
      {showCreateRule && (
        <div className="modal-overlay" onClick={() => setShowCreateRule(false)}>
          <div className="modal" data-testid="server-ui-approvals-rule-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Approval Rule</h3>
            <form onSubmit={handleCreateRule}>
              <div className="input-group">
                <label>Name <span className="text-error">*</span></label>
                <input
                  type="text"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="e.g., Require approval for file writes"
                  required
                  autoFocus
                />
              </div>
              <div className="input-group">
                <label>Tool Pattern <span className="text-error">*</span></label>
                <input
                  type="text"
                  value={ruleToolPattern}
                  onChange={(e) => setRuleToolPattern(e.target.value)}
                  placeholder="e.g., write_file or *_file"
                  required
                />
                <span className="text-muted text-sm" style={{ display: 'block', marginTop: '0.25rem' }}>
                  Glob pattern matching tool names. Use * as a wildcard.
                </span>
              </div>
              <div className="input-group">
                <label>Action</label>
                <select
                  value={ruleAction}
                  onChange={(e) => setRuleAction(e.target.value as typeof ruleAction)}
                >
                  <option value="require_approval">Require Approval</option>
                  <option value="dry_run">Dry Run</option>
                  <option value="block">Block</option>
                </select>
              </div>
              <div className="input-group">
                <label>Description</label>
                <input
                  type="text"
                  value={ruleDescription}
                  onChange={(e) => setRuleDescription(e.target.value)}
                  placeholder="Optional description"
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowCreateRule(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createLoading || !ruleName.trim() || !ruleToolPattern.trim()}
                >
                  {createLoading ? 'Creating...' : 'Create Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
