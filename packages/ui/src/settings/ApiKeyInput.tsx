import React, { useState } from 'react';
import { View, StyleSheet, TextInput, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { Button } from '../primitives/Button';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';

interface ApiKeyInputProps {
  provider: string;
  label: string;
  hasKey: boolean;
  onSave: (key: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function ApiKeyInput({
  provider: _provider,
  label,
  hasKey,
  onSave,
  onDelete,
}: ApiKeyInputProps) {
  const { colors } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!value.trim()) {
      setError('API key cannot be empty');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave(value.trim());
      setValue('');
      setIsEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await onDelete();
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setValue('');
    setError(null);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light },
        ]}
      >
        <Text style={[styles.label, { color: colors.text.primary }]}>{label}</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.bg.primary,
                color: colors.text.primary,
                borderColor: error ? colors.error : colors.border.medium,
              },
            ]}
            value={value}
            onChangeText={setValue}
            placeholder={`Enter ${label}`}
            placeholderTextColor={colors.text.muted}
            secureTextEntry
            autoFocus
            onSubmitEditing={handleSave}
          />
          {error && <Text style={[styles.error, { color: colors.error }]}>{error}</Text>}
        </View>
        <View style={styles.actions}>
          <Pressable onPress={handleCancel} disabled={saving}>
            <Text style={[styles.actionText, { color: colors.text.muted }]}>Cancel</Text>
          </Pressable>
          <Button size="sm" onPress={handleSave} loading={saving}>
            Save
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.labelContainer}>
          <Text style={[styles.label, { color: colors.text.primary }]}>{label}</Text>
          <Text style={[styles.status, { color: hasKey ? colors.success : colors.text.muted }]}>
            {hasKey ? 'Configured' : 'Not configured'}
          </Text>
        </View>
        <View style={styles.actions}>
          {hasKey ? (
            <>
              <Pressable onPress={() => setIsEditing(true)} disabled={saving}>
                <Text style={[styles.actionText, { color: colors.primary }]}>Change</Text>
              </Pressable>
              <Pressable onPress={handleDelete} disabled={saving}>
                <Text style={[styles.actionText, { color: colors.error }]}>Remove</Text>
              </Pressable>
            </>
          ) : (
            <Button size="sm" variant="secondary" onPress={() => setIsEditing(true)}>
              Add Key
            </Button>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelContainer: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
  status: {
    fontSize: 12,
    marginTop: spacing[0.5],
  },
  inputContainer: {
    marginTop: spacing[2],
  },
  input: {
    height: 36,
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderRadius: borderRadius.md,
    fontSize: 14,
  },
  error: {
    fontSize: 12,
    marginTop: spacing[1],
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[2],
    justifyContent: 'flex-end',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
