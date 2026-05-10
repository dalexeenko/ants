import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { Text } from '../primitives/Text';
import { Card } from '../primitives/Card';
import { Button } from '../primitives/Button';
import { Modal } from '../primitives/Modal';
import { Badge } from '../primitives/Badge';
import { Switch } from '../primitives/Switch';
import { IconButton, Icon } from '../primitives/IconButton';
import { Spinner } from '../primitives/Spinner';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, fontSize } from '../styles/tokens';
import type { AgentBridge, Project } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('TasksDashboard');

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Cron helpers
// ============================================================================

const CRON_PRESETS = [
  { label: 'Every Hour', value: '0 * * * *' },
  { label: 'Daily at 9am', value: '0 9 * * *' },
  { label: 'Weekly (Mon 9am)', value: '0 9 * * 1' },
  { label: 'Monthly (1st 9am)', value: '0 9 1 * *' },
  { label: 'Custom', value: 'custom' },
] as const;

function cronToHuman(cron: string): string {
  const presetMatch = CRON_PRESETS.find((p) => p.value === cron);
  if (presetMatch && presetMatch.value !== 'custom') return presetMatch.label;
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, dom, , dow] = parts;
  if (min === '0' && hour === '*') return 'Every hour';
  if (min === '0' && dom === '*' && dow === '*') return `Daily at ${hour}:00`;
  if (min === '0' && dom === '*' && dow !== '*') return `Weekly on day ${dow} at ${hour}:00`;
  if (min === '0' && dom !== '*') return `Monthly on day ${dom} at ${hour}:00`;
  return cron;
}

function formatTime(iso?: string): string {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ============================================================================
// API helper
// ============================================================================

export interface TasksDashboardProps {
  bridge: AgentBridge;
  project: Project;
}

async function apiFetch(
  bridge: AgentBridge,
  serverId: string,
  path: string,
  options?: { method?: string; body?: string },
) {
  const result = await bridge.remoteServerFetch(serverId, path, options);
  return { status: result.status, ok: result.ok, json: () => JSON.parse(result.body) };
}

// ============================================================================
// TasksDashboard
// ============================================================================

export function TasksDashboard({ bridge, project }: TasksDashboardProps) {
  const { colors } = useTheme();
  const serverId = project.remoteServerId!;

  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [detailTask, setDetailTask] = useState<ScheduledTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  // ---- Fetch tasks ----
  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch(bridge, serverId, `/projects/${project.id}/tasks`);
      if (!resp.ok) throw new Error(`Failed to load tasks (${resp.status})`);
      setTasks(resp.json().tasks);
    } catch (e) {
      log.error('Failed to load tasks', e);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [bridge, serverId, project.id]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // ---- Toggle enabled ----
  const handleToggle = useCallback(async (task: ScheduledTask) => {
    const next = !task.enabled;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, enabled: next } : t)));
    try {
      await apiFetch(bridge, serverId, `/projects/${project.id}/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      });
    } catch (e) {
      log.error('Failed to toggle task', e);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, enabled: !next } : t)));
    }
  }, [bridge, serverId, project.id]);

  // ---- Run now ----
  const handleRunNow = useCallback(async (task: ScheduledTask) => {
    setRunningIds((prev) => new Set(prev).add(task.id));
    try {
      await apiFetch(bridge, serverId, `/projects/${project.id}/tasks/${task.id}/run`, { method: 'POST' });
      await loadTasks();
    } catch (e) {
      log.error('Failed to run task', e);
    } finally {
      setRunningIds((prev) => { const s = new Set(prev); s.delete(task.id); return s; });
    }
  }, [bridge, serverId, project.id, loadTasks]);

  // ---- Delete ----
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(bridge, serverId, `/projects/${project.id}/tasks/${deleteTarget.id}`, { method: 'DELETE' });
      setTasks((prev) => prev.filter((t) => t.id !== deleteTarget.id));
    } catch (e) {
      log.error('Failed to delete task', e);
    } finally {
      setDeleteTarget(null);
    }
  }, [bridge, serverId, project.id, deleteTarget]);

  // ---- Create callback ----
  const handleCreated = useCallback((task: ScheduledTask) => {
    setTasks((prev) => [...prev, task]);
    setShowCreate(false);
  }, []);

  // ---- Detail: load history ----
  const openDetail = useCallback(async (task: ScheduledTask) => {
    try {
      const resp = await apiFetch(bridge, serverId, `/projects/${project.id}/tasks/${task.id}/history`);
      if (resp.ok) {
        setDetailTask({ ...task, runHistory: resp.json().history });
        return;
      }
    } catch (e) {
      log.warn('Failed to load task history', e);
    }
    setDetailTask(task);
  }, [bridge, serverId, project.id]);

  // ---- Render ----
  if (detailTask) {
    return (
      <TaskDetailView
        task={detailTask}
        onBack={() => setDetailTask(null)}
        colors={colors}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <Text variant="heading" style={styles.headerTitle}>Scheduled Tasks</Text>
        <View style={styles.headerActions}>
          <IconButton icon="refresh" size="sm" onPress={loadTasks} disabled={loading} />
          <Button size="sm" onPress={() => setShowCreate(true)}>New Task</Button>
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {loading ? (
          <View style={styles.centered}>
            <Spinner size="small" />
            <Text style={{ color: colors.text.muted, marginTop: spacing[2] }}>Loading tasks...</Text>
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Icon name="alertCircle" size={24} color={colors.text.muted} />
            <Text style={{ color: colors.text.muted, marginTop: spacing[2] }}>{error}</Text>
          </View>
        ) : tasks.length === 0 ? (
          <View style={styles.centered}>
            <Icon name="zap" size={32} color={colors.text.muted} />
            <Text style={{ color: colors.text.muted, marginTop: spacing[2], textAlign: 'center' }}>
              No scheduled tasks yet.{'\n'}Create one to automate agent work.
            </Text>
          </View>
        ) : (
          tasks.map((task) => (
            <Pressable
              key={task.id}
              onPress={() => openDetail(task)}
              style={[styles.card, { backgroundColor: colors.bg.secondary, borderColor: colors.border.light, opacity: task.enabled ? 1 : 0.6 }]}
            >
              <View style={styles.cardBody}>
                <View style={styles.cardRow}>
                  <Text style={[styles.cardName, { color: colors.text.primary }]}>{task.name}</Text>
                  <StatusBadge status={task.lastRunStatus} />
                </View>
                <Text style={{ color: colors.text.secondary, fontSize: fontSize.xs }}>{cronToHuman(task.cronSchedule)}</Text>
                <Text style={{ color: colors.text.muted, fontSize: fontSize.xs }}>Last run: {formatTime(task.lastRunAt)}</Text>
              </View>
              <View style={styles.cardActions}>
                <Switch value={task.enabled} onValueChange={() => handleToggle(task)} />
                <Button size="sm" variant="secondary" onPress={() => handleRunNow(task)} loading={runningIds.has(task.id)}>
                  Run Now
                </Button>
                <IconButton icon="trash" size="sm" variant="ghost" onPress={() => setDeleteTarget(task)} />
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      {showCreate && (
        <CreateTaskModal
          bridge={bridge}
          serverId={serverId}
          projectId={project.id}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      <ConfirmDialog
        visible={!!deleteTarget}
        title="Delete Task"
        message={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmText="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </View>
  );
}

// ============================================================================
// StatusBadge
// ============================================================================

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const variant = status === 'success' ? 'success' : status === 'error' ? 'error' : 'warning';
  return <Badge variant={variant} size="sm">{status}</Badge>;
}

// ============================================================================
// CreateTaskModal
// ============================================================================

function CreateTaskModal({
  bridge,
  serverId,
  projectId,
  onClose,
  onCreated,
}: {
  bridge: AgentBridge;
  serverId: string;
  projectId: string;
  onClose: () => void;
  onCreated: (task: ScheduledTask) => void;
}) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [preset, setPreset] = useState<string>(CRON_PRESETS[1].value);
  const [customCron, setCustomCron] = useState('');
  const [model, setModel] = useState('');
  const [sessionMode, setSessionMode] = useState<'new' | 'dedicated'>('new');
  const [saving, setSaving] = useState(false);

  const cronValue = preset === 'custom' ? customCron : preset;
  const valid = name.trim() && prompt.trim() && cronValue.trim();

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name, prompt, cronSchedule: cronValue, sessionMode };
      if (model.trim()) body.model = model.trim();
      const resp = await apiFetch(bridge, serverId, `/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`Create failed (${resp.status})`);
      onCreated(resp.json() as ScheduledTask);
    } catch (e) {
      log.error('Failed to create task', e);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: colors.bg.tertiary, color: colors.text.primary, borderColor: colors.border.light }];

  return (
    <Modal visible onClose={onClose} title="New Scheduled Task">
      <ScrollView style={{ maxHeight: 420 }}>
        <Text style={[styles.label, { color: colors.text.secondary }]}>Name</Text>
        <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="e.g. Nightly code review" placeholderTextColor={colors.text.muted} />

        <Text style={[styles.label, { color: colors.text.secondary, marginTop: spacing[3] }]}>Prompt</Text>
        <TextInput style={[...inputStyle, { height: 80, textAlignVertical: 'top' }]} value={prompt} onChangeText={setPrompt} placeholder="What should the agent do?" placeholderTextColor={colors.text.muted} multiline />

        <Text style={[styles.label, { color: colors.text.secondary, marginTop: spacing[3] }]}>Schedule</Text>
        <View style={styles.presetRow}>
          {CRON_PRESETS.map((p) => (
            <Pressable
              key={p.value}
              onPress={() => setPreset(p.value)}
              style={[styles.presetChip, { backgroundColor: preset === p.value ? colors.primary : colors.bg.tertiary, borderColor: preset === p.value ? colors.primary : colors.border.light }]}
            >
              <Text style={{ color: preset === p.value ? colors.text.inverse : colors.text.secondary, fontSize: fontSize.xs }}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        {preset === 'custom' && (
          <TextInput style={inputStyle} value={customCron} onChangeText={setCustomCron} placeholder="*/15 * * * *" placeholderTextColor={colors.text.muted} />
        )}

        <Text style={[styles.label, { color: colors.text.secondary, marginTop: spacing[3] }]}>Model (optional)</Text>
        <TextInput style={inputStyle} value={model} onChangeText={setModel} placeholder="Default project model" placeholderTextColor={colors.text.muted} />

        <Text style={[styles.label, { color: colors.text.secondary, marginTop: spacing[3] }]}>Session Mode</Text>
        <View style={styles.sessionToggle}>
          <Pressable
            onPress={() => setSessionMode('new')}
            style={[styles.sessionOption, { backgroundColor: sessionMode === 'new' ? colors.primary : colors.bg.tertiary }]}
          >
            <Text style={{ color: sessionMode === 'new' ? colors.text.inverse : colors.text.secondary, fontSize: fontSize.xs }}>New Each Run</Text>
          </Pressable>
          <Pressable
            onPress={() => setSessionMode('dedicated')}
            style={[styles.sessionOption, { backgroundColor: sessionMode === 'dedicated' ? colors.primary : colors.bg.tertiary }]}
          >
            <Text style={{ color: sessionMode === 'dedicated' ? colors.text.inverse : colors.text.secondary, fontSize: fontSize.xs }}>Dedicated Session</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={[styles.modalFooter, { borderTopColor: colors.border.light }]}>
        <Button variant="ghost" onPress={onClose} size="sm">Cancel</Button>
        <Button onPress={handleSave} size="sm" loading={saving} disabled={!valid}>Create Task</Button>
      </View>
    </Modal>
  );
}

// ============================================================================
// TaskDetailView
// ============================================================================

function TaskDetailView({
  task,
  onBack,
  colors,
}: {
  task: ScheduledTask;
  onBack: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const history = task.runHistory ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={{ color: colors.primary }}>Back</Text>
        </Pressable>
        <Text variant="heading" style={styles.headerTitle} numberOfLines={1}>{task.name}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.detailContent}>
        <Card variant="outlined" padding="md" style={{ marginBottom: spacing[3] }}>
          <Text style={[styles.detailLabel, { color: colors.text.muted }]}>Prompt</Text>
          <Text style={{ color: colors.text.primary, fontSize: fontSize.sm }}>{task.prompt}</Text>
          <View style={[styles.detailMeta, { marginTop: spacing[2] }]}>
            <Badge variant="default" size="sm">{cronToHuman(task.cronSchedule)}</Badge>
            <Badge variant={task.enabled ? 'success' : 'default'} size="sm">{task.enabled ? 'Enabled' : 'Disabled'}</Badge>
            {task.model && <Badge variant="primary" size="sm">{task.model}</Badge>}
            <Badge variant="secondary" size="sm">{task.sessionMode === 'dedicated' ? 'Dedicated Session' : 'New Each Run'}</Badge>
          </View>
        </Card>

        <Text style={[styles.detailLabel, { color: colors.text.muted, marginBottom: spacing[2] }]}>
          Run History ({history.length})
        </Text>

        {history.length === 0 ? (
          <Text style={{ color: colors.text.muted, fontSize: fontSize.xs }}>No runs yet.</Text>
        ) : (
          history.map((run) => (
            <View
              key={run.id}
              style={[styles.runRow, { borderLeftColor: run.status === 'success' ? colors.success : run.status === 'error' ? colors.error : colors.warning, backgroundColor: colors.bg.secondary, borderColor: colors.border.light }]}
            >
              <View style={styles.runHeader}>
                <StatusBadge status={run.status} />
                <Text style={{ color: colors.text.muted, fontSize: fontSize.xs }}>{formatTime(run.startedAt)}</Text>
                {run.finishedAt && (
                  <Text style={{ color: colors.text.muted, fontSize: fontSize.xs }}>
                    Duration: {Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s
                  </Text>
                )}
              </View>
              {run.sessionId && (
                <Text style={{ color: colors.primary, fontSize: fontSize.xs }}>Session: {run.sessionId.slice(0, 12)}...</Text>
              )}
              {run.error && (
                <Text style={{ color: colors.error, fontSize: fontSize.xs, marginTop: spacing[1] }}>{run.error}</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  headerTitle: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  backButton: { width: 60 },
  list: { flex: 1 },
  listContent: { padding: spacing[3], gap: spacing[2] },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[8] },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing[3],
    gap: spacing[3],
  },
  cardBody: { flex: 1, gap: spacing[0.5] },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  cardName: { fontSize: fontSize.sm, fontWeight: '600' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  label: { fontSize: fontSize.xs, fontWeight: '600', marginBottom: spacing[1] },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1.5],
    fontSize: fontSize.sm,
  },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1], marginBottom: spacing[2] },
  presetChip: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  sessionToggle: { flexDirection: 'row', gap: spacing[1] },
  sessionOption: {
    flex: 1,
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    marginTop: spacing[3],
  },
  detailContent: { padding: spacing[3], paddingBottom: spacing[8] },
  detailLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  detailMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
  runRow: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: borderRadius.md,
    padding: spacing[2],
    marginBottom: spacing[2],
    gap: spacing[1],
  },
  runHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
});
