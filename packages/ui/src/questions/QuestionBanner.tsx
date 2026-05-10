import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';
import { Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, colors as tokenColors } from '../styles/tokens';
import type { QuestionRequest, QuestionResponsePayload } from '../agent/types';

export interface QuestionBannerProps {
  question: QuestionRequest | null;
  onResponse: (response: QuestionResponsePayload) => void;
}

/**
 * Inline question banner that appears above the chat input.
 * Shows a question with selectable options and an optional freeform text input.
 */
export function QuestionBanner({ question, onResponse }: QuestionBannerProps) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [freeformText, setFreeformText] = useState('');
  const [showFreeform, setShowFreeform] = useState(false);

  if (!question) return null;

  const handleToggleOption = (label: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (question.multiple) {
        if (next.has(label)) {
          next.delete(label);
        } else {
          next.add(label);
        }
      } else {
        // Single select: clear all and set this one
        next.clear();
        next.add(label);
      }
      return next;
    });
    // If user selects an option, hide freeform
    setShowFreeform(false);
    setFreeformText('');
  };

  const handleSubmitSelection = () => {
    onResponse({ selected: Array.from(selected) });
    resetState();
  };

  const handleSubmitFreeform = () => {
    if (freeformText.trim()) {
      onResponse({ selected: [], freeformText: freeformText.trim() });
      resetState();
    }
  };

  const resetState = () => {
    setSelected(new Set());
    setFreeformText('');
    setShowFreeform(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.elevated, borderColor: tokenColors.info }]}>
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: tokenColors.info + '20' }]}>
          <Icon name="settings" size={16} color={tokenColors.info} />
        </View>
        <View style={styles.headerText}>
          <Text variant="caption" color="muted">
            {question.multiple ? 'Select one or more' : 'Select one'}
          </Text>
          <Text variant="body" style={styles.questionText}>{question.question}</Text>
        </View>
      </View>

      <View style={styles.optionsContainer}>
        {question.options.map((opt) => {
          const isSelected = selected.has(opt.label);
          return (
            <Pressable
              key={opt.label}
              onPress={() => handleToggleOption(opt.label)}
              style={[
                styles.option,
                {
                  backgroundColor: isSelected ? tokenColors.info + '20' : colors.bg.tertiary,
                  borderColor: isSelected ? tokenColors.info : colors.bg.tertiary,
                },
              ]}
            >
              <View style={styles.optionCheck}>
                {isSelected ? (
                  <View style={[styles.checkDot, { backgroundColor: tokenColors.info }]} />
                ) : (
                  <View style={[styles.checkEmpty, { borderColor: colors.text.secondary }]} />
                )}
              </View>
              <View style={styles.optionText}>
                <Text variant="body" style={{ fontWeight: isSelected ? '600' : '400' }}>
                  {opt.label}
                </Text>
                {opt.description ? (
                  <Text variant="caption" color="muted">{opt.description}</Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {showFreeform ? (
        <View style={styles.freeformContainer}>
          <Input
            placeholder="Type your own answer..."
            value={freeformText}
            onChange={setFreeformText}
            autoFocus
          />
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            setShowFreeform(!showFreeform);
            setSelected(new Set());
          }}
        >
          {showFreeform ? 'Back to options' : 'Type instead'}
        </Button>
        <View style={styles.actionSpacer} />
        {showFreeform ? (
          <Button
            variant="primary"
            size="sm"
            onPress={handleSubmitFreeform}
            disabled={!freeformText.trim()}
          >
            {'Submit'}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onPress={handleSubmitSelection}
            disabled={selected.size === 0}
          >
            {'Confirm'}
          </Button>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  questionText: {
    fontWeight: '600',
  },
  optionsContainer: {
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing[2],
    gap: spacing[2],
  },
  optionCheck: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDot: {
    width: 12,
    height: 12,
    borderRadius: borderRadius.full,
  },
  checkEmpty: {
    width: 12,
    height: 12,
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
  },
  optionText: {
    flex: 1,
  },
  freeformContainer: {
    marginBottom: spacing[3],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  actionSpacer: {
    width: spacing[2],
  },
});
