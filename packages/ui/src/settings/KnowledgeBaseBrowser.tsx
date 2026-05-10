import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { Button } from '../primitives/Button';
import { Modal } from '../primitives/Modal';
import { Badge } from '../primitives/Badge';
import { IconButton } from '../primitives/IconButton';
import { Input } from '../primitives/Input';
import { Spinner } from '../primitives/Spinner';
import { SearchInput } from '../primitives/SearchInput';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { useTheme } from '../styles/theme';
import { spacing, fontSize } from '../styles/tokens';
import type { AgentBridge, Project } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('KnowledgeBaseBrowser');

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

interface MemorySearchResult {
  memory: MemoryItem;
  score: number;
  matchType: 'keyword' | 'semantic' | 'hybrid';
}

interface MemoryStatus {
  available: boolean;
  memoriesWithEmbeddings: number;
  totalMemories: number;
}

export interface KnowledgeBaseBrowserProps {
  bridge: AgentBridge;
  project: Project;
}

const LIMIT = 50;

function truncate(text: string, max = 100): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd() + '...';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

function ScopeBreadcrumbs({ scope, colors }: { scope: string; colors: any }) {
  const parts = scope.split('/').filter(Boolean);
  return (
    <View style={styles.breadcrumbs}>
      <Text style={[styles.scopeText, { color: colors.text.muted }]}>/</Text>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Text style={[styles.scopeText, { color: colors.text.muted }]}>/</Text>}
          <Text style={[styles.scopeText, { color: colors.text.secondary }]}>{part}</Text>
        </React.Fragment>
      ))}
    </View>
  );
}

function MemoryForm({ content, scope, tags, author, showAuthor, onChange }: {
  content: string; scope: string; tags: string; author: string;
  showAuthor: boolean;
  onChange: (field: string, value: string) => void;
}) {
  return (
    <View style={styles.formFields}>
      <Input value={content} onChange={v => onChange('content', v)} label="Content" placeholder="Memory content..." multiline />
      <Input value={scope} onChange={v => onChange('scope', v)} label="Scope" placeholder="/" />
      <Input value={tags} onChange={v => onChange('tags', v)} label="Tags (comma-separated)" placeholder="tag1, tag2" />
      {showAuthor && <Input value={author} onChange={v => onChange('author', v)} label="Author (optional)" placeholder="author name" />}
    </View>
  );
}

// --- Main Component ---

export function KnowledgeBaseBrowser({ bridge, project }: KnowledgeBaseBrowserProps) {
  const { colors } = useTheme();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [searchResults, setSearchResults] = useState<MemorySearchResult[] | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MemoryItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [formContent, setFormContent] = useState('');
  const [formScope, setFormScope] = useState('/');
  const [formTags, setFormTags] = useState('');
  const [formAuthor, setFormAuthor] = useState('');

  const serverId = project.remoteServerId;

  const apiFetch = useCallback(async (path: string, opts?: { method?: string; body?: string }) => {
    if (!serverId) { log.warn('No remote server ID for project', project.id); return null; }
    try {
      const resp = await bridge.remoteServerFetch(serverId, path, opts);
      if (!resp.ok) { log.error(`API error ${resp.status} for ${path}`); return null; }
      return JSON.parse(resp.body);
    } catch (e) { log.error('API fetch failed', e); return null; }
  }, [bridge, serverId, project.id]);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (scopeFilter) params.set('scope', scopeFilter);
    if (tagFilter) params.set('tags', tagFilter);
    params.set('limit', String(LIMIT));
    params.set('offset', String(offset));
    const data = await apiFetch(`/projects/${project.id}/memories?${params}`);
    if (data) { setMemories(data.memories || []); setTotal(data.total || 0); }
    setLoading(false);
  }, [apiFetch, project.id, scopeFilter, tagFilter, offset]);

  const loadStatus = useCallback(async () => {
    const data = await apiFetch(`/projects/${project.id}/memories/status`);
    if (data) setStatus(data);
  }, [apiFetch, project.id]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    setLoading(true);
    const params = new URLSearchParams({ query: searchQuery, limit: '20' });
    if (scopeFilter) params.set('scope', scopeFilter);
    const data = await apiFetch(`/projects/${project.id}/memories/search?${params}`);
    if (data) setSearchResults(data.results || []);
    setLoading(false);
  }, [apiFetch, project.id, searchQuery, scopeFilter]);

  useEffect(() => { loadMemories(); loadStatus(); }, [loadMemories, loadStatus]);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    const timer = setTimeout(handleSearch, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, handleSearch]);

  const resetForm = () => { setFormContent(''); setFormScope('/'); setFormTags(''); setFormAuthor(''); };

  const handleFormChange = (field: string, value: string) => {
    if (field === 'content') setFormContent(value);
    else if (field === 'scope') setFormScope(value);
    else if (field === 'tags') setFormTags(value);
    else if (field === 'author') setFormAuthor(value);
  };

  const parseTags = () => formTags.split(',').map(t => t.trim()).filter(Boolean);

  const handleAdd = async () => {
    if (!formContent.trim()) return;
    setSaving(true);
    const body: Record<string, unknown> = { content: formContent, scope: formScope || '/', tags: parseTags() };
    if (formAuthor.trim()) body.author = formAuthor.trim();
    await apiFetch(`/projects/${project.id}/memories`, { method: 'POST', body: JSON.stringify(body) });
    setSaving(false); setShowAddModal(false); resetForm(); loadMemories(); loadStatus();
  };

  const handleEdit = async () => {
    if (!selectedMemory || !formContent.trim()) return;
    setSaving(true);
    await apiFetch(`/projects/${project.id}/memories/${selectedMemory.id}`, {
      method: 'PATCH', body: JSON.stringify({ content: formContent, scope: formScope, tags: parseTags() }),
    });
    setSaving(false); setShowEditModal(false); setSelectedMemory(null); resetForm(); loadMemories();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await apiFetch(`/projects/${project.id}/memories/${deleteTarget.id}`, { method: 'DELETE' });
    if (selectedMemory?.id === deleteTarget.id) setSelectedMemory(null);
    setDeleteTarget(null); loadMemories(); loadStatus();
  };

  const openEdit = (mem: MemoryItem) => {
    setSelectedMemory(mem); setFormContent(mem.content); setFormScope(mem.scope);
    setFormTags(mem.tags.join(', ')); setFormAuthor(mem.author || ''); setShowEditModal(true);
  };

  const pageCount = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <View style={styles.headerLeft}>
          <Text variant="heading">Knowledge Base</Text>
          {status && (
            <Badge variant={status.available ? 'success' : 'warning'} size="sm">
              {status.memoriesWithEmbeddings}/{status.totalMemories} embedded
            </Badge>
          )}
        </View>
        <Button size="sm" onPress={() => { resetForm(); setShowAddModal(true); }}>Add Memory</Button>
      </View>

      {/* Filters */}
      <View style={[styles.filters, { backgroundColor: colors.bg.secondary }]}>
        <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search memories..." size="sm" />
        <View style={styles.filterRow}>
          <View style={styles.filterField}>
            <Input value={scopeFilter} onChange={setScopeFilter} placeholder="Scope (e.g. /project)" label="Scope" />
          </View>
          <View style={styles.filterField}>
            <Input value={tagFilter} onChange={v => { setTagFilter(v); setOffset(0); }} placeholder="Tags" label="Tags" />
          </View>
        </View>
      </View>

      {/* List / Empty / Loading */}
      {loading ? (
        <View style={styles.centered}><Spinner size="large" /></View>
      ) : (searchResults ? searchResults.length : memories.length) === 0 ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.text.muted }}>
            {searchQuery ? 'No matching memories found' : 'No memories in this knowledge base'}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list}>
          {searchResults && (
            <View style={[styles.searchInfo, { backgroundColor: colors.bg.tertiary }]}>
              <Text style={{ color: colors.text.secondary, fontSize: fontSize.sm }}>
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &quot;{searchQuery}&quot;
              </Text>
            </View>
          )}
          {searchResults
            ? searchResults.map(sr => (
                <MemoryRow key={sr.memory.id} memory={sr.memory} score={sr.score} matchType={sr.matchType}
                  onSelect={m => setSelectedMemory(m)} onEdit={openEdit} onDelete={m => setDeleteTarget(m)} colors={colors} />
              ))
            : memories.map(mem => (
                <MemoryRow key={mem.id} memory={mem}
                  onSelect={m => setSelectedMemory(m)} onEdit={openEdit} onDelete={m => setDeleteTarget(m)} colors={colors} />
              ))}
          {!searchResults && pageCount > 1 && (
            <View style={styles.pagination}>
              <Button size="sm" variant="ghost" disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</Button>
              <Text style={{ color: colors.text.secondary }}>Page {currentPage} of {pageCount}</Text>
              <Button size="sm" variant="ghost" disabled={offset + LIMIT >= total} onPress={() => setOffset(offset + LIMIT)}>Next</Button>
            </View>
          )}
        </ScrollView>
      )}

      {/* Detail Modal */}
      <Modal visible={!!selectedMemory && !showEditModal} onClose={() => setSelectedMemory(null)} title="Memory Detail"
        footer={selectedMemory ? (
          <View style={styles.rowGap}>
            <Button size="sm" variant="ghost" onPress={() => openEdit(selectedMemory)}>Edit</Button>
            <Button size="sm" variant="danger" onPress={() => setDeleteTarget(selectedMemory)}>Delete</Button>
          </View>
        ) : undefined}>
        {selectedMemory && (
          <ScrollView style={styles.detailBody}>
            <ScopeBreadcrumbs scope={selectedMemory.scope} colors={colors} />
            <View style={styles.detailTags}>
              {selectedMemory.tags.map(tag => <Badge key={tag} variant="primary" size="sm">{tag}</Badge>)}
            </View>
            <Text style={[styles.detailContent, { color: colors.text.primary }]}>{selectedMemory.content}</Text>
            <View style={[styles.metaRow, { borderTopColor: colors.border.light }]}>
              {selectedMemory.author && (
                <Text style={{ color: colors.text.muted, fontSize: fontSize.xs }}>Author: {selectedMemory.author}</Text>
              )}
              <Text style={{ color: colors.text.muted, fontSize: fontSize.xs }}>Created: {formatDate(selectedMemory.createdAt)}</Text>
              <Text style={{ color: colors.text.muted, fontSize: fontSize.xs }}>Updated: {formatDate(selectedMemory.updatedAt)}</Text>
            </View>
          </ScrollView>
        )}
      </Modal>

      {/* Add Modal */}
      <Modal visible={showAddModal} onClose={() => setShowAddModal(false)} title="Add Memory"
        footer={<View style={styles.rowGap}>
          <Button variant="ghost" onPress={() => setShowAddModal(false)}>Cancel</Button>
          <Button onPress={handleAdd} loading={saving} disabled={!formContent.trim()}>Save</Button>
        </View>}>
        <MemoryForm content={formContent} scope={formScope} tags={formTags} author={formAuthor} showAuthor onChange={handleFormChange} />
      </Modal>

      {/* Edit Modal */}
      <Modal visible={showEditModal} onClose={() => { setShowEditModal(false); setSelectedMemory(null); }} title="Edit Memory"
        footer={<View style={styles.rowGap}>
          <Button variant="ghost" onPress={() => { setShowEditModal(false); setSelectedMemory(null); }}>Cancel</Button>
          <Button onPress={handleEdit} loading={saving} disabled={!formContent.trim()}>Save Changes</Button>
        </View>}>
        <MemoryForm content={formContent} scope={formScope} tags={formTags} author={formAuthor} showAuthor={false} onChange={handleFormChange} />
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog visible={!!deleteTarget} title="Delete Memory"
        message={`Delete this memory? This cannot be undone.\n\n"${truncate(deleteTarget?.content || '', 80)}"`}
        confirmText="Delete" destructive onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
    </View>
  );
}

// --- Memory Row ---

function MemoryRow({ memory, score, matchType, onSelect, onEdit, onDelete, colors }: {
  memory: MemoryItem; score?: number; matchType?: string;
  onSelect: (m: MemoryItem) => void; onEdit: (m: MemoryItem) => void;
  onDelete: (m: MemoryItem) => void; colors: any;
}) {
  return (
    <Pressable style={[styles.memoryRow, { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light }]}
      onPress={() => onSelect(memory)}>
      <View style={styles.memoryMain}>
        <Text style={[styles.memoryPreview, { color: colors.text.primary }]} numberOfLines={2}>
          {truncate(memory.content)}
        </Text>
        <ScopeBreadcrumbs scope={memory.scope} colors={colors} />
        {memory.tags.length > 0 && (
          <View style={styles.tagRow}>
            {memory.tags.map(tag => <Badge key={tag} variant="default" size="sm">{tag}</Badge>)}
          </View>
        )}
        <View style={styles.timestampRow}>
          <Text style={{ color: colors.text.muted, fontSize: fontSize.xs }}>{formatDate(memory.updatedAt)}</Text>
          {score != null && (
            <Badge variant={matchType === 'semantic' ? 'primary' : matchType === 'hybrid' ? 'success' : 'secondary'} size="sm">
              {matchType} {(score * 100).toFixed(0)}%
            </Badge>
          )}
        </View>
      </View>
      <View style={styles.memoryActions}>
        <IconButton icon="pencil" size="sm" variant="ghost" onPress={() => onEdit(memory)} />
        <IconButton icon="trash" size="sm" variant="ghost" onPress={() => onDelete(memory)} />
      </View>
    </Pressable>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[3], borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  filters: { padding: spacing[3], gap: spacing[2], borderBottomWidth: 1, borderBottomColor: 'transparent' },
  filterRow: { flexDirection: 'row', gap: spacing[2] },
  filterField: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing[8] },
  list: { flex: 1 },
  searchInfo: { paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  memoryRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: spacing[3], paddingHorizontal: spacing[4], borderBottomWidth: 1,
  },
  memoryMain: { flex: 1, gap: spacing[1] },
  memoryPreview: { fontSize: 14, lineHeight: 20 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1], marginTop: spacing[0.5] },
  timestampRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[1] },
  memoryActions: { flexDirection: 'row', gap: spacing[1], marginLeft: spacing[2] },
  breadcrumbs: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  scopeText: { fontFamily: 'monospace', fontSize: 12 },
  pagination: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing[4], paddingVertical: spacing[4],
  },
  detailBody: { maxHeight: 400 },
  detailContent: { fontSize: 14, lineHeight: 22, marginTop: spacing[3] },
  detailTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1], marginTop: spacing[2] },
  metaRow: { marginTop: spacing[4], paddingTop: spacing[3], borderTopWidth: 1, gap: spacing[1] },
  rowGap: { flexDirection: 'row', gap: spacing[2] },
  formFields: { gap: spacing[3] },
});
