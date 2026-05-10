import React, { useState } from 'react';
import { View, Pressable, StyleSheet, TextInput } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon, IconButton } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, fontSize } from '../styles/tokens';

export interface BranchInfo {
  id: string;
  name: string;
  isActive: boolean;
  messageCount: number;
}

export interface BranchControlProps {
  /** List of available branches */
  branches: BranchInfo[];
  /** Currently active branch */
  activeBranch: BranchInfo | null;
  /** Called when user switches to a branch */
  onSwitch?: (branchId: string) => void;
  /** Called when user creates a new branch */
  onCreate?: (name: string) => void;
  /** Called when user deletes a branch */
  onDelete?: (branchId: string) => void;
  /** Called when user wants to rollback N messages */
  onRollback?: (count: number) => void;
}

export function BranchControl({
  branches,
  activeBranch,
  onSwitch,
  onCreate,
  onDelete,
  onRollback,
}: BranchControlProps) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');

  // Only show if there are multiple branches or branching has been used
  if (branches.length <= 1 && !expanded) {
    return (
      <Pressable
        onPress={() => setExpanded(true)}
        style={[styles.compactButton, { borderColor: colors.border.light }]}
      >
        <Icon name="gitBranch" size={12} color={colors.text.muted} />
        <Text variant="caption" color="muted">
          {activeBranch?.name ?? 'main'}
        </Text>
      </Pressable>
    );
  }

  const handleCreate = () => {
    if (newBranchName.trim()) {
      onCreate?.(newBranchName.trim());
      setNewBranchName('');
      setCreating(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.elevated, borderColor: colors.border.light }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="gitBranch" size={14} color={colors.text.secondary} />
          <Text variant="caption" weight="medium">Branches</Text>
        </View>
        <View style={styles.headerRight}>
          <IconButton
            icon="plus"
            size="sm"
            variant="ghost"
            onPress={() => setCreating(!creating)}
          />
          <IconButton
            icon="chevronUp"
            size="sm"
            variant="ghost"
            onPress={() => setExpanded(false)}
          />
        </View>
      </View>

      {/* Create new branch */}
      {creating && (
        <View style={[styles.createRow, { borderTopColor: colors.border.light }]}>
          <TextInput
            value={newBranchName}
            onChangeText={setNewBranchName}
            placeholder="Branch name..."
            placeholderTextColor={colors.text.muted}
            style={[
              styles.createInput,
              {
                color: colors.text.primary,
                backgroundColor: colors.bg.tertiary,
                borderColor: colors.border.light,
              },
            ]}
            onSubmitEditing={handleCreate}
            autoFocus
          />
          <IconButton
            icon="check"
            size="sm"
            variant="ghost"
            onPress={handleCreate}
          />
        </View>
      )}

      {/* Branch list */}
      {branches.map((branch) => (
        <Pressable
          key={branch.id}
          style={[
            styles.branchRow,
            { borderTopColor: colors.border.light },
            branch.isActive && { backgroundColor: colors.bg.tertiary },
          ]}
          onPress={() => !branch.isActive && onSwitch?.(branch.id)}
        >
          <View style={styles.branchInfo}>
            {branch.isActive ? (
              <Icon name="check" size={12} color={colors.success} />
            ) : (
              <View style={{ width: 12 }} />
            )}
            <Text
              variant="caption"
              weight={branch.isActive ? 'medium' : 'normal'}
              numberOfLines={1}
            >
              {branch.name}
            </Text>
            <Text variant="caption" color="muted">
              ({branch.messageCount} msgs)
            </Text>
          </View>
          {!branch.isActive && branch.id !== 'main' && (
            <IconButton
              icon="close"
              size="sm"
              variant="ghost"
              onPress={() => onDelete?.(branch.id)}
            />
          )}
        </Pressable>
      ))}

      {/* Rollback control */}
      {onRollback && (
        <View style={[styles.rollbackRow, { borderTopColor: colors.border.light }]}>
          <Text variant="caption" color="muted">Rollback:</Text>
          {[1, 2, 5].map((n) => (
            <Pressable
              key={n}
              onPress={() => onRollback(n)}
              style={[styles.rollbackButton, { backgroundColor: colors.bg.tertiary }]}
            >
              <Text variant="caption" color="secondary">-{n}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  compactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderWidth: 1,
    borderRadius: borderRadius.sm,
  },
  container: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderTopWidth: 1,
  },
  createInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    fontSize: fontSize.xs,
  },
  branchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderTopWidth: 1,
  },
  branchInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flex: 1,
  },
  rollbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderTopWidth: 1,
  },
  rollbackButton: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
});
