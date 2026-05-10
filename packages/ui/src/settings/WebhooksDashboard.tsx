import React, { useEffect, useState } from 'react';
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
import { spacing, borderRadius, palette as paletteTokens } from '../styles/tokens';
import type { AgentBridge, Project } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('WebhooksDashboard');

interface WebhookEndpoint {
  id: string; name: string; slug: string;
  source: 'github' | 'gitlab' | 'bitbucket' | 'ci' | 'generic';
  secret?: string; eventFilter?: string; promptTemplate: string;
  sessionMode?: string; enabled: boolean; deliveryCount: number; lastTriggeredAt?: string;
}

interface Delivery {
  id: string; status: 'pending' | 'processing' | 'completed' | 'failed' | 'ignored';
  event: string; createdAt: string; payload?: unknown;
}

interface FileWatcher {
  id: string; name: string; watchPath: string; patterns?: string; ignorePatterns?: string;
  events?: string[]; debounceMs?: number; promptTemplate: string; enabled: boolean;
}

const SOURCE_COLORS: Record<string, string> = {
  github: paletteTokens.violet, gitlab: paletteTokens.orange, bitbucket: paletteTokens.info, ci: paletteTokens.success,
};
const DELIVERY_VARIANTS: Record<string, 'success' | 'error' | 'primary' | 'warning' | 'default'> = {
  completed: 'success', failed: 'error', processing: 'primary', pending: 'warning', ignored: 'default',
};
const TEMPLATE_VARS = '{{event}}, {{source}}, {{summary}}, {{payload}}, {{payload.field}}';
const SOURCES = ['github', 'gitlab', 'bitbucket', 'ci', 'generic'] as const;

interface WebhooksDashboardProps { bridge: AgentBridge; project: Project; serverUrl?: string }

export function WebhooksDashboard({ bridge, project, serverUrl }: WebhooksDashboardProps) {
  const { colors } = useTheme();
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [watchers, setWatchers] = useState<FileWatcher[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [showWatcherModal, setShowWatcherModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'webhook' | 'watcher'; id: string; name: string } | null>(null);
  const serverId = project.remoteServerId!;

  const apiFetch = async (path: string, opts?: { method?: string; body?: string }) => {
    const r = await bridge.remoteServerFetch(serverId, path, opts);
    return { ok: r.ok, status: r.status, json: () => JSON.parse(r.body) };
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [epR, wR] = await Promise.all([
        apiFetch(`/projects/${project.id}/webhooks`),
        apiFetch(`/projects/${project.id}/watchers`),
      ]);
      if (epR.ok) setEndpoints(epR.json().endpoints || []);
      if (wR.ok) setWatchers(wR.json().watchers || []);
    } catch (e) { log.error('Failed to load webhook data:', e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [project.id]);

  const loadDeliveries = async (id: string) => {
    try {
      const r = await apiFetch(`/projects/${project.id}/webhooks/${id}/deliveries?limit=20`);
      if (r.ok) setDeliveries((p) => ({ ...p, [id]: r.json().deliveries || [] }));
    } catch (e) { log.error('Failed to load deliveries:', e); }
  };

  const toggleEndpoint = async (ep: WebhookEndpoint) => {
    try {
      await apiFetch(`/projects/${project.id}/webhooks/${ep.id}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: !ep.enabled }),
      });
      setEndpoints((p) => p.map((e) => (e.id === ep.id ? { ...e, enabled: !e.enabled } : e)));
    } catch (e) { log.error('Failed to toggle endpoint:', e); }
  };

  const toggleWatcher = async (w: FileWatcher, val: boolean) => {
    try {
      await apiFetch(`/projects/${project.id}/watchers/${w.id}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: val }),
      });
      setWatchers((p) => p.map((x) => (x.id === w.id ? { ...x, enabled: val } : x)));
    } catch (e) { log.error('Failed to toggle watcher:', e); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { type, id } = deleteTarget;
    try {
      await apiFetch(`/projects/${project.id}/${type === 'webhook' ? 'webhooks' : 'watchers'}/${id}`, { method: 'DELETE' });
      if (type === 'webhook') setEndpoints((p) => p.filter((e) => e.id !== id));
      else setWatchers((p) => p.filter((w) => w.id !== id));
    } catch (e) { log.error(`Failed to delete ${type}:`, e); }
    finally { setDeleteTarget(null); }
  };

  const handleExpand = (id: string) => {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (next) loadDeliveries(next);
  };

  const copyUrl = (text: string) => {
    try { navigator?.clipboard?.writeText(text); } catch (e) { log.warn('Clipboard failed:', e); }
  };

  const handleCreate = async (type: 'webhooks' | 'watchers', body: Record<string, unknown>) => {
    await apiFetch(`/projects/${project.id}/${type}`, { method: 'POST', body: JSON.stringify(body) });
    await loadData();
  };

  if (loading) {
    return (
      <View style={[s.centered, { padding: spacing[8] }]}>
        <Spinner size="small" />
        <Text style={{ color: colors.text.muted, marginLeft: spacing[2] }}>Loading webhooks...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }}>
      {/* Webhook Endpoints */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Text variant="heading" style={{ color: colors.text.primary }}>Webhook Endpoints</Text>
          <Button size="sm" onPress={() => setShowWebhookModal(true)}>Add Webhook</Button>
        </View>
        {endpoints.length === 0 ? (
          <View style={[s.empty, { backgroundColor: colors.bg.secondary }]}>
            <Text style={{ color: colors.text.muted }}>No webhook endpoints configured</Text>
          </View>
        ) : endpoints.map((ep) => {
          const hookUrl = serverUrl ? `${serverUrl}/api/beta/hooks/${project.id}/${ep.slug}` : '';
          return (
            <Card key={ep.id} style={{ marginBottom: spacing[2] }}>
              <Pressable onPress={() => handleExpand(ep.id)} style={s.row}>
                <View style={s.info}>
                  <View style={s.rowHeader}>
                    <Text style={[s.nameText, { color: colors.text.primary }]}>{ep.name}</Text>
                    <View style={[s.srcBadge, { backgroundColor: (SOURCE_COLORS[ep.source] || colors.text.muted) + '20' }]}>
                      <Text style={{ color: SOURCE_COLORS[ep.source] || colors.text.muted, fontSize: 10, fontWeight: '600', textTransform: 'uppercase' }}>{ep.source}</Text>
                    </View>
                  </View>
                  <Text style={{ color: colors.text.muted, fontSize: 12 }}>
                    {ep.deliveryCount} deliveries{ep.lastTriggeredAt ? ` · Last: ${new Date(ep.lastTriggeredAt).toLocaleDateString()}` : ''}
                  </Text>
                  {hookUrl ? (
                    <Pressable onPress={() => copyUrl(hookUrl)} style={s.urlRow}>
                      <Text style={{ color: colors.text.muted, fontSize: 11 }} numberOfLines={1}>{hookUrl}</Text>
                      <Text style={{ color: colors.primary, fontSize: 11, marginLeft: spacing[1] }}>Copy</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={s.actions}>
                  <Switch value={ep.enabled} onValueChange={() => toggleEndpoint(ep)} />
                  <IconButton icon="trash" size="sm" onPress={() => setDeleteTarget({ type: 'webhook', id: ep.id, name: ep.name })} />
                </View>
              </Pressable>
              {expandedId === ep.id && (
                <View style={[s.deliveries, { borderTopColor: colors.border.light }]}>
                  <Text style={[s.subHead, { color: colors.text.secondary }]}>Recent Deliveries</Text>
                  {!(deliveries[ep.id]?.length) ? (
                    <Text style={{ color: colors.text.muted, fontSize: 12 }}>No deliveries yet</Text>
                  ) : deliveries[ep.id].map((d) => (
                    <View key={d.id} style={[s.dRow, { borderBottomColor: colors.border.light }]}>
                      <Badge variant={DELIVERY_VARIANTS[d.status] || 'default'} size="sm">{d.status}</Badge>
                      <Text style={{ color: colors.text.secondary, fontSize: 12, flex: 1, marginLeft: spacing[2] }}>{d.event}</Text>
                      <Text style={{ color: colors.text.muted, fontSize: 11 }}>{new Date(d.createdAt).toLocaleTimeString()}</Text>
                      {d.payload != null ? (
                        <Text style={{ color: colors.text.muted, fontSize: 10, marginTop: 2 }} numberOfLines={2}>
                          {JSON.stringify(d.payload).slice(0, 120)}...
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}
            </Card>
          );
        })}
      </View>

      {/* File Watchers */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Text variant="heading" style={{ color: colors.text.primary }}>File Watchers</Text>
          <Button size="sm" onPress={() => setShowWatcherModal(true)}>Add Watcher</Button>
        </View>
        {watchers.length === 0 ? (
          <View style={[s.empty, { backgroundColor: colors.bg.secondary }]}>
            <Text style={{ color: colors.text.muted }}>No file watchers configured</Text>
          </View>
        ) : watchers.map((w) => (
          <Card key={w.id} style={{ marginBottom: spacing[2] }}>
            <View style={s.row}>
              <View style={s.info}>
                <Text style={[s.nameText, { color: colors.text.primary }]}>{w.name}</Text>
                <Text style={{ color: colors.text.muted, fontSize: 12 }}>{w.watchPath}</Text>
                {w.patterns && <Text style={{ color: colors.text.muted, fontSize: 11 }}>Patterns: {w.patterns}</Text>}
                {w.events && w.events.length > 0 && (
                  <View style={s.tags}>{w.events.map((ev) => <Badge key={ev} variant="secondary" size="sm">{ev}</Badge>)}</View>
                )}
              </View>
              <View style={s.actions}>
                <Switch value={w.enabled} onValueChange={(v) => toggleWatcher(w, v)} />
                <IconButton icon="trash" size="sm" onPress={() => setDeleteTarget({ type: 'watcher', id: w.id, name: w.name })} />
              </View>
            </View>
          </Card>
        ))}
      </View>

      <CreateWebhookModal visible={showWebhookModal} onClose={() => setShowWebhookModal(false)}
        onCreate={async (body) => { try { await handleCreate('webhooks', body); setShowWebhookModal(false); } catch (e) { log.error('Create webhook failed:', e); } }} />
      <CreateWatcherModal visible={showWatcherModal} onClose={() => setShowWatcherModal(false)}
        onCreate={async (body) => { try { await handleCreate('watchers', body); setShowWatcherModal(false); } catch (e) { log.error('Create watcher failed:', e); } }} />
      <ConfirmDialog visible={!!deleteTarget} title={`Delete ${deleteTarget?.type === 'webhook' ? 'Webhook' : 'Watcher'}`}
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmText="Delete" destructive onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
    </ScrollView>
  );
}

// ============ Create Webhook Modal ============

function CreateWebhookModal({ visible, onClose, onCreate }: {
  visible: boolean; onClose: () => void; onCreate: (body: Record<string, unknown>) => Promise<void>;
}) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [source, setSource] = useState<string>('generic');
  const [secret, setSecret] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState('build');
  const [saving, setSaving] = useState(false);

  const toSlug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const reset = () => { setName(''); setSlug(''); setSource('generic'); setSecret(''); setEventFilter(''); setPrompt(''); setMode('build'); };
  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!name.trim() || !slug.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), slug: slug.trim(), source, promptTemplate: prompt, sessionMode: mode, enabled: true };
      if (secret.trim()) body.secret = secret.trim();
      if (eventFilter.trim()) body.eventFilter = eventFilter.trim();
      await onCreate(body);
      reset();
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} onClose={handleClose} title="Create Webhook" footer={
      <View style={s.footer}><Button variant="ghost" onPress={handleClose}>Cancel</Button><Button onPress={handleSubmit} loading={saving} disabled={!name.trim()}>Create</Button></View>
    }>
      <ScrollView style={{ maxHeight: 420 }}>
        <Field label="Name" colors={colors}>
          <TextInput style={inp(colors)} value={name} onChangeText={(v) => { setName(v); setSlug(toSlug(v)); }} placeholder="My Webhook" placeholderTextColor={colors.text.muted} />
        </Field>
        <Field label="Slug" colors={colors}>
          <TextInput style={inp(colors)} value={slug} onChangeText={setSlug} placeholder="my-webhook" placeholderTextColor={colors.text.muted} />
        </Field>
        <Field label="Source" colors={colors}>
          <View style={s.typeSel}>
            {SOURCES.map((src) => (
              <Pressable key={src} onPress={() => setSource(src)} style={[s.typeOpt, { borderColor: source === src ? (SOURCE_COLORS[src] || colors.text.muted) : colors.border.medium }, source === src && { backgroundColor: (SOURCE_COLORS[src] || colors.text.muted) + '15' }]}>
                <Text style={{ color: source === src ? (SOURCE_COLORS[src] || colors.text.muted) : colors.text.secondary, fontSize: 12, textTransform: 'capitalize' }}>{src}</Text>
              </Pressable>
            ))}
          </View>
        </Field>
        <Field label="Secret (optional)" colors={colors}>
          <TextInput style={inp(colors)} value={secret} onChangeText={setSecret} placeholder="webhook-secret" placeholderTextColor={colors.text.muted} secureTextEntry />
        </Field>
        <Field label="Event Filter (comma-separated)" colors={colors}>
          <TextInput style={inp(colors)} value={eventFilter} onChangeText={setEventFilter} placeholder="push, pull_request, release" placeholderTextColor={colors.text.muted} />
        </Field>
        <Field label="Prompt Template" colors={colors}>
          <TextInput style={[inp(colors), { height: 80, textAlignVertical: 'top' }]} value={prompt} onChangeText={setPrompt} multiline numberOfLines={4} placeholder="Handle this {{event}} from {{source}}..." placeholderTextColor={colors.text.muted} />
          <Text style={{ color: colors.text.muted, fontSize: 11, marginTop: spacing[1] }}>Variables: {TEMPLATE_VARS}</Text>
        </Field>
        <Field label="Session Mode" colors={colors}>
          <View style={s.typeSel}>
            {['build', 'plan'].map((m) => (
              <Pressable key={m} onPress={() => setMode(m)} style={[s.typeOpt, { borderColor: mode === m ? colors.primary : colors.border.medium }, mode === m && { backgroundColor: colors.bg.tertiary }]}>
                <Text style={{ color: mode === m ? colors.primary : colors.text.secondary, textTransform: 'capitalize' }}>{m}</Text>
              </Pressable>
            ))}
          </View>
        </Field>
      </ScrollView>
    </Modal>
  );
}

// ============ Create Watcher Modal ============

function CreateWatcherModal({ visible, onClose, onCreate }: {
  visible: boolean; onClose: () => void; onCreate: (body: Record<string, unknown>) => Promise<void>;
}) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [watchPath, setWatchPath] = useState('');
  const [patterns, setPatterns] = useState('');
  const [ignorePatterns, setIgnorePatterns] = useState('');
  const [events, setEvents] = useState<Record<string, boolean>>({ change: true, add: true, unlink: false });
  const [debounce, setDebounce] = useState('500');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(''); setWatchPath(''); setPatterns(''); setIgnorePatterns(''); setEvents({ change: true, add: true, unlink: false }); setDebounce('500'); setPrompt(''); };
  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!name.trim() || !watchPath.trim()) return;
    setSaving(true);
    try {
      const sel = Object.entries(events).filter(([, v]) => v).map(([k]) => k);
      const body: Record<string, unknown> = { name: name.trim(), watchPath: watchPath.trim(), promptTemplate: prompt, enabled: true };
      if (patterns.trim()) body.patterns = patterns.trim();
      if (ignorePatterns.trim()) body.ignorePatterns = ignorePatterns.trim();
      if (sel.length) body.events = sel;
      if (debounce.trim()) body.debounceMs = parseInt(debounce, 10) || 500;
      await onCreate(body);
      reset();
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} onClose={handleClose} title="Create File Watcher" footer={
      <View style={s.footer}><Button variant="ghost" onPress={handleClose}>Cancel</Button><Button onPress={handleSubmit} loading={saving} disabled={!name.trim() || !watchPath.trim()}>Create</Button></View>
    }>
      <ScrollView style={{ maxHeight: 420 }}>
        <Field label="Name" colors={colors}>
          <TextInput style={inp(colors)} value={name} onChangeText={setName} placeholder="Config watcher" placeholderTextColor={colors.text.muted} />
        </Field>
        <Field label="Watch Path" colors={colors}>
          <TextInput style={inp(colors)} value={watchPath} onChangeText={setWatchPath} placeholder="/src/config" placeholderTextColor={colors.text.muted} />
        </Field>
        <Field label="Glob Patterns (comma-separated)" colors={colors}>
          <TextInput style={inp(colors)} value={patterns} onChangeText={setPatterns} placeholder="**/*.ts, **/*.json" placeholderTextColor={colors.text.muted} />
        </Field>
        <Field label="Ignore Patterns (comma-separated)" colors={colors}>
          <TextInput style={inp(colors)} value={ignorePatterns} onChangeText={setIgnorePatterns} placeholder="node_modules/**, dist/**" placeholderTextColor={colors.text.muted} />
        </Field>
        <Field label="Events" colors={colors}>
          <View style={s.cbRow}>
            {(['change', 'add', 'unlink'] as const).map((ev) => (
              <Pressable key={ev} style={s.cbItem} onPress={() => setEvents((p) => ({ ...p, [ev]: !p[ev] }))}>
                <View style={[s.cb, { borderColor: colors.border.medium }, events[ev] && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                  {events[ev] && <Text style={{ color: colors.text.inverse, fontSize: 10, fontWeight: '700' }}>{'✓'}</Text>}
                </View>
                <Text style={{ color: colors.text.secondary, fontSize: 13, marginLeft: spacing[1.5] }}>{ev}</Text>
              </Pressable>
            ))}
          </View>
        </Field>
        <Field label="Debounce (ms)" colors={colors}>
          <TextInput style={inp(colors)} value={debounce} onChangeText={setDebounce} placeholder="500" placeholderTextColor={colors.text.muted} keyboardType="numeric" />
        </Field>
        <Field label="Prompt Template" colors={colors}>
          <TextInput style={[inp(colors), { height: 80, textAlignVertical: 'top' }]} value={prompt} onChangeText={setPrompt} multiline numberOfLines={4} placeholder="File {{event}} detected at {{source}}..." placeholderTextColor={colors.text.muted} />
          <Text style={{ color: colors.text.muted, fontSize: 11, marginTop: spacing[1] }}>Variables: {TEMPLATE_VARS}</Text>
        </Field>
      </ScrollView>
    </Modal>
  );
}

// ============ Helpers ============

function Field({ label, colors, children }: { label: string; colors: any; children: React.ReactNode }) {
  return <View style={s.formGroup}><Text style={[s.label, { color: colors.text.primary }]}>{label}</Text>{children}</View>;
}

const inp = (c: any) => ({
  height: 40, paddingHorizontal: spacing[3], borderWidth: 1,
  borderRadius: borderRadius.md, fontSize: 14,
  backgroundColor: c.bg.primary, color: c.text.primary, borderColor: c.border.medium,
});

// ============ Styles ============

const s = StyleSheet.create({
  centered: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  section: { marginBottom: spacing[6], paddingHorizontal: spacing[4] },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[3] },
  empty: { padding: spacing[4], alignItems: 'center', borderRadius: borderRadius.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: spacing[3] },
  info: { flex: 1, marginRight: spacing[3] },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[1] },
  nameText: { fontSize: 14, fontWeight: '500' },
  srcBadge: { paddingHorizontal: spacing[1.5], paddingVertical: spacing[0.5], borderRadius: borderRadius.full },
  urlRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing[0.5] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  deliveries: { borderTopWidth: 1, paddingHorizontal: spacing[3], paddingVertical: spacing[3] },
  subHead: { fontSize: 12, fontWeight: '600', marginBottom: spacing[2] },
  dRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[2], borderBottomWidth: StyleSheet.hairlineWidth },
  tags: { flexDirection: 'row', gap: spacing[1], marginTop: spacing[1] },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[2] },
  formGroup: { marginBottom: spacing[4] },
  label: { fontSize: 14, fontWeight: '500', marginBottom: spacing[2] },
  typeSel: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  typeOpt: { paddingVertical: spacing[1.5], paddingHorizontal: spacing[3], borderWidth: 1, borderRadius: borderRadius.md },
  cbRow: { flexDirection: 'row', gap: spacing[4] },
  cbItem: { flexDirection: 'row', alignItems: 'center' },
  cb: { width: 18, height: 18, borderWidth: 1.5, borderRadius: borderRadius.sm, alignItems: 'center', justifyContent: 'center' },
});
