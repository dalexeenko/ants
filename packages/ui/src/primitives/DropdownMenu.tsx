import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Pressable, StyleSheet, Modal, Platform, Dimensions } from 'react-native';
import { Text } from './Text';
import { Icon, IconButton, type IconName } from './IconButton';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, shadows } from '../styles/tokens';

export interface DropdownMenuItem {
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

export interface DropdownMenuProps {
  /** Menu items to display */
  items: DropdownMenuItem[];
  /** Icon for the trigger button */
  icon?: IconName;
  /** Size of the trigger button */
  size?: 'sm' | 'md' | 'lg';
  /** Whether dropdown is disabled */
  disabled?: boolean;
}

/**
 * Dropdown menu component triggered by a button click.
 */
export function DropdownMenu({
  items,
  icon = 'more',
  size = 'sm',
  disabled = false,
}: DropdownMenuProps) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<any>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;

    const handleClickOutside = () => {
      // Small delay to allow the menu item click to process first
      setTimeout(() => setVisible(false), 0);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document;
    if (doc) {
      doc.addEventListener('click', handleClickOutside);
      return () => {
        doc.removeEventListener('click', handleClickOutside);
      };
    }
  }, [visible]);

  const handleOpen = useCallback(
    (e: any) => {
      if (disabled) return;
      e?.stopPropagation?.();

      // Get button position for menu placement
      if (buttonRef.current) {
        if (Platform.OS === 'web') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const element = buttonRef.current as any;
          const rect = element.getBoundingClientRect?.();
          if (rect) {
            setPosition({
              x: rect.left,
              y: rect.bottom + 4,
            });
          }
          setVisible(true);
        } else {
          // Native: measure the button position before showing menu
          buttonRef.current.measureInWindow?.((x: number, y: number, _width: number, height: number) => {
            const screenWidth = Dimensions.get('window').width;
            const menuWidth = 160; // minWidth from styles
            // Position menu below button, but keep it on screen
            const menuX = Math.min(x, screenWidth - menuWidth - 16);
            setPosition({
              x: Math.max(8, menuX),
              y: y + height + 4,
            });
            setVisible(true);
          });
        }
      } else {
        setVisible(true);
      }
    },
    [disabled]
  );

  const handleItemPress = useCallback((item: DropdownMenuItem) => {
    if (item.disabled) return;
    setVisible(false);
    item.onPress();
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
  }, []);

  if (items.length === 0) return null;

  return (
    <>
      <View ref={buttonRef}>
        <IconButton
          icon={icon}
          size={size}
          variant="ghost"
          onPress={handleOpen}
          disabled={disabled}
        />
      </View>

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
                onPress={(e) => {
                  e.stopPropagation();
                  handleItemPress(item);
                }}
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
