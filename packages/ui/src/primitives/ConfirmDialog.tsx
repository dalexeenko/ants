import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { Button } from './Button';
import { Modal } from './Modal';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';

export interface ConfirmDialogProps {
  /** Whether the dialog is visible */
  visible: boolean;
  /** Dialog title */
  title: string;
  /** Dialog message */
  message: string;
  /** Confirm button text */
  confirmText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Whether the action is destructive (shows red confirm button) */
  destructive?: boolean;
  /** Called when confirm is clicked */
  onConfirm: () => void;
  /** Called when cancel is clicked or dialog is dismissed */
  onCancel: () => void;
  /** Whether confirm action is loading */
  loading?: boolean;
}

/**
 * Confirmation dialog component.
 * Used for confirming destructive or important actions.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} onClose={onCancel} title={title}>
      <View style={styles.content}>
        <Text style={[styles.message, { color: colors.text.secondary }]}>
          {message}
        </Text>

        <View style={styles.actions}>
          <Button
            variant="ghost"
            onPress={onCancel}
            disabled={loading}
            style={styles.button}
          >
            {cancelText}
          </Button>
          <Button
            variant={destructive ? 'secondary' : 'primary'}
            onPress={onConfirm}
            loading={loading}
            style={[
              styles.button,
              destructive && { backgroundColor: colors.error },
            ]}
          >
            {confirmText}
          </Button>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Hook for managing confirm dialog state.
 */
export function useConfirmDialog() {
  const [state, setState] = React.useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    destructive?: boolean;
    onConfirm?: () => void | Promise<void>;
  }>({
    visible: false,
    title: '',
    message: '',
  });

  const [loading, setLoading] = React.useState(false);

  const confirm = React.useCallback(
    (options: {
      title: string;
      message: string;
      confirmText?: string;
      cancelText?: string;
      destructive?: boolean;
    }): Promise<boolean> => {
      return new Promise((resolve) => {
        setState({
          ...options,
          visible: true,
          onConfirm: () => resolve(true),
        });
      });
    },
    []
  );

  const handleConfirm = React.useCallback(async () => {
    if (state.onConfirm) {
      setLoading(true);
      try {
        await state.onConfirm();
      } finally {
        setLoading(false);
      }
    }
    setState((s) => ({ ...s, visible: false }));
  }, [state.onConfirm]);

  const handleCancel = React.useCallback(() => {
    setState((s) => ({ ...s, visible: false }));
  }, []);

  const dialog = (
    <ConfirmDialog
      visible={state.visible}
      title={state.title}
      message={state.message}
      confirmText={state.confirmText}
      cancelText={state.cancelText}
      destructive={state.destructive}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      loading={loading}
    />
  );

  return { confirm, dialog };
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[4],
  },
  message: {
    marginBottom: spacing[4],
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
  },
  button: {
    minWidth: 80,
  },
});
