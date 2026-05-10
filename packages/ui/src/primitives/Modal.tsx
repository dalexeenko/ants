import React from 'react';
import {
  Modal as RNModal,
  View,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text } from './Text';
import { IconButton } from './IconButton';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, shadows } from '../styles/tokens';

export interface ModalProps {
  visible: boolean;
  onClose?: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Test identifier — maps to data-testid on web, testID on native */
  testID?: string;
}

export function Modal({
  visible,
  onClose,
  title,
  children,
  footer,
  testID,
}: ModalProps) {
  const { colors } = useTheme();

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable
            testID={testID}
            style={[
              styles.content,
              { backgroundColor: colors.bg.primary },
              shadows.lg,
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            {title && (
              <View
                style={[
                  styles.header,
                  { borderBottomColor: colors.border.light },
                ]}
              >
                <Text variant="heading" style={styles.title}>
                  {title}
                </Text>
                {onClose && (
                  <IconButton icon="close" onPress={onClose} size="sm" />
                )}
              </View>
            )}
            <View style={styles.body} pointerEvents="box-none">{children}</View>
            {footer && (
              <View
                style={[
                  styles.footer,
                  { borderTopColor: colors.border.light },
                ]}
              >
                {footer}
              </View>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  content: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '90%',
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  title: {
    flex: 1,
  },
  body: {
    padding: spacing[4],
    flexShrink: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
  },
});
