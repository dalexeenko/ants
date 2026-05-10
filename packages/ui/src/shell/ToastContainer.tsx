import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  ThemeContext,
  useUIStore,
  Text,
  Button,
  Spinner,
} from '../index';

export function ToastContainer() {
  const { toasts, removeToast } = useUIStore();
  const { colors, palette } = React.useContext(ThemeContext);

  if (toasts.length === 0) return null;

  return (
    <View style={styles.toastContainer}>
      {toasts.map((toast) => (
        <View
          key={toast.id}
          style={[
            styles.toast,
            toast.type === 'error' && { backgroundColor: palette.errorHover, borderColor: palette.errorHover },
            toast.type === 'success' && { backgroundColor: colors.success, borderColor: colors.success },
            toast.type === 'warning' && { backgroundColor: colors.warning, borderColor: colors.warning },
            toast.type === 'info' && { backgroundColor: colors.info, borderColor: colors.info },
            // Default style for untyped toasts
            !['error', 'success', 'warning', 'info'].includes(toast.type) && { backgroundColor: colors.border.medium, borderColor: colors.border.medium },
          ]}
        >
          {toast.loading && (
            <View style={styles.toastSpinner}>
              <Spinner size="small" color={palette.white} />
            </View>
          )}
          <Text style={[styles.toastText, { color: palette.white }]}>{toast.message}</Text>
          {!toast.loading && (
            <Button variant="ghost" size="sm" onPress={() => removeToast(toast.id)}>
              ×
            </Button>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    gap: 8,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 300,
    maxWidth: 400,
    borderWidth: 1,
    boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.3)',
  },
  
  toastSpinner: {
    marginRight: 12,
  },
  toastText: {
    flex: 1,
  },
});
