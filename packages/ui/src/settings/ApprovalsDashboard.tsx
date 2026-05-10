import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { Text } from '../primitives/Text';
import { Card } from '../primitives/Card';
import { Button } from '../primitives/Button';
import { Modal } from '../primitives/Modal';
import { Badge } from '../primitives/Badge';
import { Switch } from '../primitives/Switch';
import { IconButton } from '../primitives/IconButton';
import { Spinner } from '../primitives/Spinner';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import type { AgentBridge, Project } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('ApprovalsDashboard');

interface ApprovalRule {
  id: string;
  projectId?: string;
  name: string;
  description?: string;
  toolPattern: string;
  argPatterns?: Record<string, string>;
  action: 'require_approval' | 'dry_run' | 'block';
  priority: number;
  enabled: boolean;
  isDefault?: boolean;
}

interface ApprovalRequest {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  sessionId?: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'auto_approved';
  createdAt: string;
  expiresAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  note?: string;
}

type TabKey = 'rules' | 'pending' | 'history';

interface CreateRuleForm {
  name: string;
  description: string;
  toolPattern: string;
  argPatterns: Record<string, string>;
  action: ApprovalRule['action'];
  priority: number;
}

const ACTION_BADGE: Record<string, 'warning' | 'primary' | 'error'> = {
  require_approval: 'warning', dry_run: 'primary', block: 'error',
};
const STATUS_BADGE: Record<string, 'warning' | 'success' | 'error' | 'secondary' | 'primary'> = {
  pending: 'warning', approved: 'success', denied: 'error', expired: 'secondary', auto_approved: 'primary',
};
const EMPTY_FORM: CreateRuleForm = {
  name: '', description: '', toolPattern: '', argPatterns: {}, action: 'require_approval', priority: 100,
};
const ACTION_OPTIONS: { value: CreateRuleForm['action']; label: string }[] = [
  { value: 'require_approval', label: 'Require Approval' },
  { value: 'dry_run', label: 'Dry Run' },
  { value: 'block', label: 'Block' },
];

function formatTimeRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const m = Math.floor(diff / 60000), s = Math.floor((diff % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function truncateJson(obj: Record<string, unknown>, max = 80): string {
  const s = JSON.stringify(obj);
  return s.length > max ? s.slice(0, max) + '...' : s;
}

// ============ Main Component ============

export function ApprovalsDashboard({ bridge, project }: { bridge: AgentBridge; project: Project }) {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<TabKey>('rules');
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [history, setHistory] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApprovalRule | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const serverId = project.remoteServerId!;

  const fetchJson = useCallback(async (path: string, opts?: { method?: string; body?: string }) => {
    const resp = await bridge.remoteServerFetch(serverId, path, opts);
    return JSON.parse(resp.body);
  }, [bridge, serverId]);

  const loadRules = useCallback(async () => {
    try { setRules((await fetchJson(`/approvals/rules?projectId=${project.id}`)).rules); }
    catch (e) { log.error('Failed to load approval rules:', e); }
  }, [fetchJson, project.id]);

  const loadPending = useCallback(async () => {
    try { setPending((await fetchJson(`/approvals/requests?projectId=${project.id}&status=pending`)).requests); }
    catch (e) { log.error('Failed to load pending approvals:', e); }
  }, [fetchJson, project.id]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchJson(`/approvals/requests?projectId=${project.id}`);
      setHistory(data.requests.filter((r: ApprovalRequest) => r.status !== 'pending'));
    } catch (e) { log.error('Failed to load approval history:', e); }
  }, [fetchJson, project.id]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadRules(), loadPending(), loadHistory()]);
      setLoading(false);
    })();
  }, [loadRules, loadPending, loadHistory]);

  useEffect(() => {
    pollRef.current = setInterval(loadPending, 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadPending]);

  const toggleRule = async (rule: ApprovalRule) => {
    try {
      await fetchJson(`/approvals/rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !rule.enabled }) });
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
    } catch (e) { log.error('Failed to toggle rule:', e); }
  };

  const deleteRule = async () => {
    if (!deleteTarget) return;
    try {
      await fetchJson(`/approvals/rules/${deleteTarget.id}`, { method: 'DELETE' });
      setRules((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    } catch (e) { log.error('Failed to delete rule:', e); }
    finally { setDeleteTarget(null); }
  };

  const createRule = async (form: CreateRuleForm) => {
    try {
      const body: Record<string, unknown> = { projectId: project.id, name: form.name, toolPattern: form.toolPattern, action: form.action };
      if (form.description) body.description = form.description;
      if (form.priority !== undefined) body.priority = form.priority;
      if (Object.keys(form.argPatterns).length > 0) body.argPatterns = form.argPatterns;
      await fetchJson('/approvals/rules', { method: 'POST', body: JSON.stringify(body) });
      setShowCreate(false);
      loadRules();
    } catch (e) { log.error('Failed to create rule:', e); }
  };

  const handleDecision = async (id: string, decision: 'approve' | 'deny', note?: string) => {
    try {
      await fetchJson(`/approvals/requests/${id}/${decision}`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) });
      loadPending();
      loadHistory();
    } catch (e) { log.error(`Failed to ${decision} request:`, e); }
  };

  if (loading) {
    return (
      <View style={[s.center, { padding: spacing[8] }]}>
        <Spinner size="large" />
        <Text style={{ color: colors.text.muted, marginTop: spacing[3] }}>Loading approvals...</Text>
      </View>
    );
  }

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'rules', label: 'Rules', count: rules.length },
    { key: 'pending', label: 'Pending', count: pending.length },
    { key: 'history', label: 'History' },
  ];

  return (
    <View style={s.container}>
      <View style={[s.tabBar, { borderBottomColor: colors.border.light }]}>
        {tabs.map((t) => (
          <Pressable key={t.key} style={[s.tab, activeTab === t.key && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]} onPress={() => setActiveTab(t.key)}>
            <Text style={{ color: activeTab === t.key ? colors.primary : colors.text.muted, fontWeight: '500', fontSize: 14 }}>{t.label}</Text>
            {(t.count ?? 0) > 0 && <Badge variant={t.key === 'pending' ? 'warning' : 'default'} size="sm">{t.count}</Badge>}
          </Pressable>
        ))}
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={{ padding: spacing[4] }}>
        {activeTab === 'rules' && <RulesTab rules={rules} onToggle={toggleRule} onDelete={setDeleteTarget} onCreate={() => setShowCreate(true)} />}
        {activeTab === 'pending' && <PendingTab requests={pending} onDecision={handleDecision} />}
        {activeTab === 'history' && <HistoryTab requests={history} />}
      </ScrollView>
      <CreateRuleModal visible={showCreate} onClose={() => setShowCreate(false)} onSubmit={createRule} />
      <ConfirmDialog visible={deleteTarget !== null} title="Delete Rule" message={`Delete "${deleteTarget?.name}"? This cannot be undone.`} confirmText="Delete" destructive onConfirm={deleteRule} onCancel={() => setDeleteTarget(null)} />
    </View>
  );
}

// ============ Rules Tab ============

function RulesTab({ rules, onToggle, onDelete, onCreate }: {
  rules: ApprovalRule[]; onToggle: (r: ApprovalRule) => void; onDelete: (r: ApprovalRule) => void; onCreate: () => void;
}) {
  const { colors } = useTheme();
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  return (
    <View style={{ gap: spacing[2] }}>
      <View style={s.row}>
        <Text style={{ color: colors.text.primary, fontWeight: '600', fontSize: 16 }}>Approval Rules</Text>
        <Button variant="primary" size="sm" onPress={onCreate}>Add Rule</Button>
      </View>
      {sorted.length === 0 ? (
        <Text style={{ color: colors.text.muted, padding: spacing[4] }}>No approval rules configured.</Text>
      ) : sorted.map((rule) => (
        <Card key={rule.id} variant="outlined" padding="sm" style={{ marginBottom: spacing[1] }}>
          <View style={s.ruleRow}>
            <View style={{ flex: 1, gap: spacing[0.5] }}>
              <View style={s.badges}>
                <Text style={{ color: colors.text.primary, fontWeight: '500', fontSize: 14 }}>{rule.name}</Text>
                <Badge variant={ACTION_BADGE[rule.action]} size="sm">{rule.action.replace('_', ' ')}</Badge>
                {rule.isDefault && <Badge variant="default" size="sm">Built-in</Badge>}
              </View>
              <Text style={{ color: colors.text.muted, fontSize: 12, fontFamily: 'monospace' }}>{rule.toolPattern}</Text>
              {rule.description && <Text style={{ color: colors.text.secondary, fontSize: 12 }}>{rule.description}</Text>}
              <Text style={{ color: colors.text.muted, fontSize: 11 }}>Priority: {rule.priority}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginLeft: spacing[3] }}>
              <Switch value={rule.enabled} onValueChange={() => onToggle(rule)} />
              {!rule.isDefault && <IconButton icon="close" size="sm" onPress={() => onDelete(rule)} />}
            </View>
          </View>
        </Card>
      ))}
    </View>
  );
}

// ============ Pending Tab ============

function PendingTab({ requests, onDecision }: {
  requests: ApprovalRequest[]; onDecision: (id: string, d: 'approve' | 'deny', note?: string) => void;
}) {
  const { colors } = useTheme();
  if (requests.length === 0) return <Text style={{ color: colors.text.muted, padding: spacing[4], textAlign: 'center' }}>No pending approval requests.</Text>;
  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={{ color: colors.text.primary, fontWeight: '600', fontSize: 16 }}>Pending Approvals</Text>
      {requests.map((req) => <PendingCard key={req.id} request={req} onDecision={onDecision} />)}
    </View>
  );
}

function PendingCard({ request, onDecision }: {
  request: ApprovalRequest; onDecision: (id: string, d: 'approve' | 'deny', note?: string) => void;
}) {
  const { colors } = useTheme();
  const [note, setNote] = useState('');
  const [timeLeft, setTimeLeft] = useState(() => request.expiresAt ? formatTimeRemaining(request.expiresAt) : '30m');

  useEffect(() => {
    if (!request.expiresAt) return;
    const iv = setInterval(() => setTimeLeft(formatTimeRemaining(request.expiresAt!)), 1000);
    return () => clearInterval(iv);
  }, [request.expiresAt]);

  return (
    <Card variant="outlined" padding="sm">
      <View style={s.row}>
        <Text style={{ color: colors.text.primary, fontWeight: '500', fontSize: 14 }}>{request.toolName}</Text>
        <Badge variant="warning" size="sm">{timeLeft}</Badge>
      </View>
      <Text style={{ color: colors.text.muted, fontSize: 12, fontFamily: 'monospace', marginTop: spacing[1] }}>{truncateJson(request.arguments)}</Text>
      {request.sessionId && <Text style={{ color: colors.text.muted, fontSize: 11 }}>Session: {request.sessionId.slice(0, 8)}...</Text>}
      <TextInput
        style={[s.input, { borderColor: colors.border.medium, color: colors.text.primary, backgroundColor: colors.bg.secondary, marginTop: spacing[2] }]}
        placeholder="Optional note..." placeholderTextColor={colors.text.muted} value={note} onChangeText={setNote}
      />
      <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2], justifyContent: 'flex-end' }}>
        <Button variant="primary" size="sm" onPress={() => onDecision(request.id, 'approve', note || undefined)}>Approve</Button>
        <Button variant="danger" size="sm" onPress={() => onDecision(request.id, 'deny', note || undefined)}>Deny</Button>
      </View>
    </Card>
  );
}

// ============ History Tab ============

function HistoryTab({ requests }: { requests: ApprovalRequest[] }) {
  const { colors } = useTheme();
  const sorted = [...requests].sort((a, b) => new Date(b.reviewedAt || b.createdAt).getTime() - new Date(a.reviewedAt || a.createdAt).getTime());
  if (sorted.length === 0) return <Text style={{ color: colors.text.muted, padding: spacing[4], textAlign: 'center' }}>No approval history yet.</Text>;
  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={{ color: colors.text.primary, fontWeight: '600', fontSize: 16 }}>Approval History</Text>
      {sorted.map((req) => (
        <Card key={req.id} variant="outlined" padding="sm">
          <View style={s.row}>
            <Text style={{ color: colors.text.primary, fontWeight: '500', fontSize: 14 }}>{req.toolName}</Text>
            <Badge variant={STATUS_BADGE[req.status]} size="sm">{req.status.replace('_', ' ')}</Badge>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing[3], marginTop: spacing[1] }}>
            {req.reviewedBy && <Text style={{ color: colors.text.secondary, fontSize: 12 }}>By: {req.reviewedBy}</Text>}
            <Text style={{ color: colors.text.muted, fontSize: 12 }}>{new Date(req.reviewedAt || req.createdAt).toLocaleString()}</Text>
          </View>
          {req.note && <Text style={{ color: colors.text.secondary, fontSize: 12, marginTop: spacing[1], fontStyle: 'italic' }}>&quot;{req.note}&quot;</Text>}
        </Card>
      ))}
    </View>
  );
}

// ============ Create Rule Modal ============

function CreateRuleModal({ visible, onClose, onSubmit }: { visible: boolean; onClose: () => void; onSubmit: (f: CreateRuleForm) => void }) {
  const { colors } = useTheme();
  const [form, setForm] = useState<CreateRuleForm>(EMPTY_FORM);
  const [argInput, setArgInput] = useState('');

  const reset = () => { setForm(EMPTY_FORM); setArgInput(''); onClose(); };

  const addArg = () => {
    const m = argInput.match(/^([^=]+)=(.+)$/);
    if (m) { setForm((f) => ({ ...f, argPatterns: { ...f.argPatterns, [m[1].trim()]: m[2].trim() } })); setArgInput(''); }
  };

  const removeArg = (key: string) => {
    setForm((f) => { const next = { ...f.argPatterns }; delete next[key]; return { ...f, argPatterns: next }; });
  };

  const valid = form.name.trim() !== '' && form.toolPattern.trim() !== '';
  const inputStyle = { borderColor: colors.border.medium, color: colors.text.primary, backgroundColor: colors.bg.secondary };

  return (
    <Modal visible={visible} onClose={reset} title="Create Approval Rule" footer={
      <View style={{ flexDirection: 'row', gap: spacing[2], justifyContent: 'flex-end' }}>
        <Button variant="ghost" size="sm" onPress={reset}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={!valid} onPress={() => onSubmit(form)}>Create</Button>
      </View>
    }>
      <FormField label="Name *">
        <TextInput style={[s.input, inputStyle]} value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="e.g. Block destructive writes" placeholderTextColor={colors.text.muted} />
      </FormField>
      <FormField label="Description">
        <TextInput style={[s.input, inputStyle]} value={form.description} onChangeText={(v) => setForm((f) => ({ ...f, description: v }))} placeholder="Optional description" placeholderTextColor={colors.text.muted} />
      </FormField>
      <FormField label="Tool Pattern *" hint="Supports glob patterns: * matches any characters">
        <TextInput style={[s.input, inputStyle]} value={form.toolPattern} onChangeText={(v) => setForm((f) => ({ ...f, toolPattern: v }))} placeholder="e.g. bash, file_write, mcp_*" placeholderTextColor={colors.text.muted} />
      </FormField>
      <FormField label="Argument Patterns">
        <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center' }}>
          <TextInput style={[s.input, inputStyle, { flex: 1 }]} value={argInput} onChangeText={setArgInput} placeholder="key=value" placeholderTextColor={colors.text.muted} onSubmitEditing={addArg} />
          <Button variant="secondary" size="sm" onPress={addArg} disabled={!argInput.includes('=')}>Add</Button>
        </View>
        {Object.entries(form.argPatterns).map(([k, v]) => (
          <View key={k} style={[s.argTag, { backgroundColor: colors.bg.tertiary }]}>
            <Text style={{ color: colors.text.secondary, fontSize: 12, fontFamily: 'monospace' }}>{k}={v}</Text>
            <IconButton icon="close" size="sm" onPress={() => removeArg(k)} />
          </View>
        ))}
      </FormField>
      <FormField label="Action">
        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
          {ACTION_OPTIONS.map((opt) => (
            <Pressable key={opt.value} style={[s.actionChip, { borderColor: form.action === opt.value ? colors.primary : colors.border.medium }, form.action === opt.value && { backgroundColor: colors.bg.tertiary }]} onPress={() => setForm((f) => ({ ...f, action: opt.value }))}>
              <Text style={{ color: form.action === opt.value ? colors.primary : colors.text.secondary, fontSize: 13, fontWeight: '500' }}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      </FormField>
      <FormField label="Priority" hint="Lower numbers run first">
        <TextInput style={[s.input, inputStyle, { width: 80 }]} value={String(form.priority)} onChangeText={(v) => setForm((f) => ({ ...f, priority: parseInt(v, 10) || 0 }))} keyboardType="numeric" />
      </FormField>
    </Modal>
  );
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: spacing[4] }}>
      <Text style={{ fontSize: 13, fontWeight: '500', marginBottom: spacing[1], color: colors.text.primary }}>{label}</Text>
      {children}
      {hint && <Text style={{ color: colors.text.muted, fontSize: 11, marginTop: spacing[0.5] }}>{hint}</Text>}
    </View>
  );
}

// ============ Styles ============

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, paddingHorizontal: spacing[4] },
  tab: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], paddingVertical: spacing[3], paddingHorizontal: spacing[3], marginBottom: -1 },
  scroll: { flex: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  ruleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  input: { borderWidth: 1, borderRadius: borderRadius.md, paddingHorizontal: spacing[3], paddingVertical: spacing[2], fontSize: 13 },
  argTag: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[2], paddingVertical: spacing[1], borderRadius: borderRadius.sm, marginTop: spacing[1] },
  actionChip: { borderWidth: 1, borderRadius: borderRadius.md, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
});
