import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { Switch } from '../primitives/Switch';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import type { AgentBridge, ToolPermissionConfig } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('PermissionSettings');

interface PermissionSettingsProps {
  bridge: AgentBridge;
  projectId: string;
}

export function PermissionSettings({ bridge, projectId }: PermissionSettingsProps) {
  const { colors } = useTheme();
  const [config, setConfig] = useState<ToolPermissionConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConfig();
  }, [projectId]);

  const loadConfig = async () => {
    try {
      const permConfig = await bridge.getPermissionConfig(projectId);
      setConfig(permConfig);
    } catch (e) {
      log.error('Failed to load permission config:', e);
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = async (updates: Partial<ToolPermissionConfig>) => {
    if (!config) return;

    const newConfig = { ...config, ...updates };
    setConfig(newConfig);

    try {
      await bridge.updatePermissionConfig(projectId, updates);
    } catch (e) {
      log.error('Failed to update permission config:', e);
      // Revert on error
      loadConfig();
    }
  };

  const handleModeChange = (mode: 'allow' | 'ask' | 'deny') => {
    updateConfig({ defaultMode: mode });
  };

  const handleAllowAllToggle = (value: boolean) => {
    updateConfig({ allowAll: value });
  };

  if (loading) {
    return (
      <SettingsSection
        title="Tool Permissions"
        description="Control which tools the agent can use without asking"
      >
        <View style={styles.loading}>
          <Text style={{ color: colors.text.muted }}>Loading...</Text>
        </View>
      </SettingsSection>
    );
  }

  if (!config) {
    return null;
  }

  return (
    <SettingsSection
      title="Tool Permissions"
      description="Control which tools the agent can use without asking"
    >
      {/* Allow All Toggle */}
      <SettingsRow
        title="Allow All Tools"
        description="Skip all permission prompts (not recommended)"
        action={
          <Switch
            value={config.allowAll}
            onValueChange={handleAllowAllToggle}
            trackColor={{ false: colors.border.medium, true: colors.primary }}
          />
        }
      />

      {/* Default Mode */}
      {!config.allowAll && (
        <>
          <View
            style={[
              styles.modeSection,
              { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light },
            ]}
          >
            <Text style={[styles.modeLabel, { color: colors.text.primary }]}>
              Default Permission Mode
            </Text>
            <View style={styles.modeOptions}>
              <ModeOption
                label="Ask"
                description="Prompt for dangerous operations"
                selected={config.defaultMode === 'ask'}
                onSelect={() => handleModeChange('ask')}
              />
              <ModeOption
                label="Allow"
                description="Allow all operations without asking"
                selected={config.defaultMode === 'allow'}
                onSelect={() => handleModeChange('allow')}
              />
              <ModeOption
                label="Deny"
                description="Deny all operations by default"
                selected={config.defaultMode === 'deny'}
                onSelect={() => handleModeChange('deny')}
              />
            </View>
          </View>

          {/* Always Allow Tools */}
          <View
            style={[
              styles.toolListSection,
              { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light },
            ]}
          >
            <Text style={[styles.toolListLabel, { color: colors.text.primary }]}>
              Always Allowed Tools
            </Text>
            <Text style={[styles.toolListDescription, { color: colors.text.muted }]}>
              These tools will never require permission
            </Text>
            <View style={styles.toolList}>
              {config.alwaysAllow.map((tool) => (
                <View
                  key={tool}
                  style={[styles.toolTag, { backgroundColor: colors.bg.tertiary }]}
                >
                  <Text style={[styles.toolTagText, { color: colors.text.secondary }]}>
                    {tool}
                  </Text>
                </View>
              ))}
              {config.alwaysAllow.length === 0 && (
                <Text style={{ color: colors.text.muted }}>None</Text>
              )}
            </View>
          </View>

          {/* Always Deny Tools */}
          <View
            style={[
              styles.toolListSection,
              { backgroundColor: colors.bg.secondary, borderBottomWidth: 0 },
            ]}
          >
            <Text style={[styles.toolListLabel, { color: colors.text.primary }]}>
              Always Denied Tools
            </Text>
            <Text style={[styles.toolListDescription, { color: colors.text.muted }]}>
              These tools will always be blocked
            </Text>
            <View style={styles.toolList}>
              {config.alwaysDeny.map((tool) => (
                <View
                  key={tool}
                  style={[styles.toolTag, { backgroundColor: colors.bg.tertiary }]}
                >
                  <Text style={[styles.toolTagText, { color: colors.text.secondary }]}>
                    {tool}
                  </Text>
                </View>
              ))}
              {config.alwaysDeny.length === 0 && (
                <Text style={{ color: colors.text.muted }}>None</Text>
              )}
            </View>
          </View>
        </>
      )}
    </SettingsSection>
  );
}

// ============ Mode Option ============

interface ModeOptionProps {
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}

function ModeOption({ label, description, selected, onSelect }: ModeOptionProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      style={[
        styles.modeOption,
        { borderColor: selected ? colors.primary : colors.border.medium },
        selected && { backgroundColor: colors.bg.tertiary },
      ]}
      onPress={onSelect}
    >
      <View style={styles.modeOptionRadio}>
        <View
          style={[
            styles.radioOuter,
            { borderColor: selected ? colors.primary : colors.border.medium },
          ]}
        >
          {selected && (
            <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />
          )}
        </View>
      </View>
      <View style={styles.modeOptionContent}>
        <Text
          style={[
            styles.modeOptionLabel,
            { color: selected ? colors.primary : colors.text.primary },
          ]}
        >
          {label}
        </Text>
        <Text style={[styles.modeOptionDescription, { color: colors.text.muted }]}>
          {description}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: {
    padding: spacing[4],
    alignItems: 'center',
  },
  modeSection: {
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
  },
  modeLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: spacing[3],
  },
  modeOptions: {
    gap: spacing[2],
  },
  modeOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing[3],
    borderWidth: 1,
    borderRadius: 8,
  },
  modeOptionRadio: {
    marginRight: spacing[3],
    marginTop: 2,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  modeOptionContent: {
    flex: 1,
  },
  modeOptionLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  modeOptionDescription: {
    fontSize: 12,
    marginTop: spacing[0.5],
  },
  toolListSection: {
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
  },
  toolListLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: spacing[1],
  },
  toolListDescription: {
    fontSize: 12,
    marginBottom: spacing[2],
  },
  toolList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  toolTag: {
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    borderRadius: 4,
  },
  toolTagText: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
