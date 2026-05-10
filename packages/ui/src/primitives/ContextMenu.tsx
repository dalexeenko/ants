import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Pressable, StyleSheet, Modal } from 'react-native';
import { Text } from './Text';
import { Icon, type IconName } from './IconButton';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, shadows } from '../styles/tokens';

export interface ContextMenuItem {
  /** Unique identifier for the item */
  id: string;
  /** Display label */
  label: string;
  /** Optional icon */
  icon?: IconName;
  /** Whether this is a destructive action */
  destructive?: boolean;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Called when item is selected */
  onPress: () => void;
}

export interface ContextMenuProps {
  /** Menu items to display */
  items: ContextMenuItem[];
  /** The element that triggers the context menu */
  children: React.ReactNode;
  /** Whether context menu is disabled */
  disabled?: boolean;
}

interface MenuPosition {
  x: number;
  y: number;
}

/**
 * Context menu component that shows on right-click (web) or long press (mobile).
 */
export function ContextMenu({
  items,
  children,
  disabled = false,
}: ContextMenuProps) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ x: 0, y: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerRef = useRef<any>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = () => {
      setVisible(false);
    };

    // For web, add document click listener
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document;
    if (doc) {
      doc.addEventListener('click', handleClickOutside);
      doc.addEventListener('contextmenu', handleClickOutside);
      return () => {
        doc.removeEventListener('click', handleClickOutside);
        doc.removeEventListener('contextmenu', handleClickOutside);
      };
    }
  }, [visible]);

  const handleContextMenu = useCallback(
    (event: any) => {
      if (disabled) return;

      // Prevent default context menu
      event.preventDefault?.();
      event.stopPropagation?.();

      // Get position from event
      const x = event.nativeEvent?.pageX || event.pageX || event.clientX || 0;
      const y = event.nativeEvent?.pageY || event.pageY || event.clientY || 0;

      setPosition({ x, y });
      setVisible(true);
    },
    [disabled]
  );

  const handleLongPress = useCallback(
    (event: any) => {
      if (disabled) return;

      // Get position from event for mobile
      const x = event.nativeEvent?.pageX || 100;
      const y = event.nativeEvent?.pageY || 100;

      setPosition({ x, y });
      setVisible(true);
    },
    [disabled]
  );

  const handleItemPress = useCallback(
    (item: ContextMenuItem) => {
      if (item.disabled) return;
      setVisible(false);
      item.onPress();
    },
    []
  );

  const handleClose = useCallback(() => {
    setVisible(false);
  }, []);

  return (
    <>
      <Pressable
        ref={containerRef}
        onLongPress={handleLongPress}
        delayLongPress={500}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...({ onContextMenu: handleContextMenu } as any)}
      >
        {children}
      </Pressable>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={handleClose}
      >
        <Pressable style={styles.overlay} onPress={handleClose}>
          <View
            style={[
              styles.menu,
              {
                backgroundColor: colors.bg.elevated,
                borderColor: colors.border.light,
                left: position.x,
                top: position.y,
                ...shadows.lg,
              },
            ]}
          >
            {items.map((item, index) => (
              <Pressable
                key={item.id}
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && !item.disabled && { backgroundColor: colors.bg.tertiary },
                  index === 0 && styles.menuItemFirst,
                  index === items.length - 1 && styles.menuItemLast,
                  item.disabled && styles.menuItemDisabled,
                ]}
                onPress={() => handleItemPress(item)}
                disabled={item.disabled}
              >
                {item.icon && (
                  <Icon
                    name={item.icon}
                    size={14}
                    color={
                      item.disabled
                        ? colors.text.muted
                        : item.destructive
                        ? colors.error
                        : colors.text.primary
                    }
                  />
                )}
                <Text
                  style={[
                    styles.menuItemText,
                    item.disabled && { color: colors.text.muted },
                    item.destructive && !item.disabled && { color: colors.error },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * Hook to create context menu items with proper typing.
 */
export function useContextMenu(
  items: ContextMenuItem[]
): ContextMenuItem[] {
  return items;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  menu: {
    position: 'absolute',
    minWidth: 160,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  menuItemFirst: {
    borderTopLeftRadius: borderRadius.md,
    borderTopRightRadius: borderRadius.md,
  },
  menuItemLast: {
    borderBottomLeftRadius: borderRadius.md,
    borderBottomRightRadius: borderRadius.md,
  },
  menuItemDisabled: {
    opacity: 0.5,
  },
  menuItemText: {
    fontSize: 14,
  },
});
