import React, { useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Text } from '../primitives/Text';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, fontSize } from '../styles/tokens';
import { createLogger } from '../utils/logger';

const log = createLogger('CodeBlock');

export interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
}

export function CodeBlock({
  code,
  language,
  filename,
  showLineNumbers = true,
}: CodeBlockProps) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  const lines = code.split('\n');
  // Remove trailing empty line if present
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  const handleCopy = async () => {
    try {
      // Use navigator.clipboard if available (web/Electron)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = typeof globalThis !== 'undefined' ? (globalThis as any).navigator : undefined;
      if (nav?.clipboard) {
        await nav.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {
      log.error('Failed to copy:', e);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.tertiary }]}>
      {/* Header with language and copy button */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <View style={styles.headerLeft}>
          {filename ? (
            <Text style={[styles.filename, { color: colors.text.secondary }]}>
              {filename}
            </Text>
          ) : language ? (
            <Text style={[styles.language, { color: colors.text.muted }]}>
              {language}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={handleCopy} style={styles.copyButton}>
          <Text style={[styles.copyText, { color: colors.text.muted }]}>
            {copied ? 'Copied!' : 'Copy'}
          </Text>
        </Pressable>
      </View>

      {/* Code content */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.codeContent}>
          {showLineNumbers && (
            <View style={[styles.lineNumbers, { borderRightColor: colors.border.light }]}>
              {lines.map((_, index) => (
                <Text
                  key={index}
                  style={[styles.lineNumber, { color: colors.text.muted }]}
                >
                  {index + 1}
                </Text>
              ))}
            </View>
          )}
          <View style={styles.codeLines}>
            {lines.map((line, index) => (
              <Text key={index} selectable style={[styles.codeLine, { color: colors.text.primary }]}>
                {line || ' '}
              </Text>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    marginVertical: spacing[2],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filename: {
    fontSize: fontSize.sm,
    fontFamily: 'monospace',
  },
  language: {
    fontSize: fontSize.xs,
    textTransform: 'lowercase',
  },
  copyButton: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  copyText: {
    fontSize: fontSize.xs,
  },
  codeContent: {
    flexDirection: 'row',
    padding: spacing[3],
  },
  lineNumbers: {
    paddingRight: spacing[3],
    marginRight: spacing[3],
    borderRightWidth: 1,
    alignItems: 'flex-end',
    minWidth: 32,
  },
  lineNumber: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    fontFamily: 'monospace',
  },
  codeLines: {
    flex: 1,
  },
  codeLine: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    fontFamily: 'monospace',
  },
});
