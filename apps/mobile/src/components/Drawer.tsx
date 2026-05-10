/**
 * Drawer Component
 * 
 * A slide-out sidebar drawer for mobile navigation.
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
  PanResponder,
  Platform,
  Keyboard,
} from 'react-native';
import { ThemeContext, Text, Divider, spacing, palette } from '@openmgr/ui';
import { Home, Settings, Sparkles, Users, X } from 'lucide-react-native';

const DRAWER_WIDTH = 280;

interface DrawerItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
}

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: DrawerItem[];
  activeItemId?: string;
}

export function Drawer({ isOpen, onClose, items, activeItemId }: DrawerProps) {
  const { colors } = React.useContext(ThemeContext);
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOpen) {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: -DRAWER_WIDTH,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isOpen, translateX, backdropOpacity]);

  // Pan responder for swipe to close
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          translateX.setValue(Math.max(gestureState.dx, -DRAWER_WIDTH));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -50 || gestureState.vx < -0.5) {
          onClose();
        } else {
          Animated.timing(translateX, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  if (!isOpen) {
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View
        style={[
          styles.backdrop,
          {
            opacity: backdropOpacity.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.5],
            }),
          },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => { Keyboard.dismiss(); onClose(); }} />
      </Animated.View>

      {/* Drawer */}
      <Animated.View
        testID="openmgr-drawer"
        {...panResponder.panHandlers}
        style={[
          styles.drawer,
          {
            backgroundColor: colors.bg.secondary,
            borderRightColor: colors.border.light,
            transform: [{ translateX }],
          },
        ]}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
          <Text variant="title">OpenMgr</Text>
          <Pressable
            testID="openmgr-drawer-close"
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              { backgroundColor: pressed ? colors.bg.tertiary : 'transparent' },
            ]}
          >
            <X size={20} color={colors.text.secondary} />
          </Pressable>
        </View>

        {/* Navigation Items */}
        <View style={styles.content}>
          {items.map((item) => {
            const isActive = item.id === activeItemId;
            return (
              <Pressable
                testID={`openmgr-drawer-${item.id}`}
                key={item.id}
                onPress={() => {
                  item.onPress();
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.navItem,
                  {
                    backgroundColor: isActive
                      ? colors.bg.tertiary
                      : pressed
                      ? colors.bg.tertiary
                      : 'transparent',
                  },
                ]}
              >
                <View style={styles.navItemIcon}>{item.icon}</View>
                <Text
                  style={[
                    styles.navItemLabel,
                    { color: isActive ? colors.primary : colors.text.primary },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Divider />
          <Text color="muted" style={styles.footerText}>
            v0.1.0
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

interface DrawerNavigationProps {
  currentScreen: string;
  onNavigateToHome: () => void;
  onNavigateToDirector: () => void;
  onNavigateToAgents: () => void;
  onNavigateToSettings: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export function DrawerNavigation({
  currentScreen,
  onNavigateToHome,
  onNavigateToDirector,
  onNavigateToAgents,
  onNavigateToSettings,
  isOpen,
  onClose,
}: DrawerNavigationProps) {
  const { colors } = React.useContext(ThemeContext);

  const items: DrawerItem[] = [
    {
      id: 'home',
      label: 'Home',
      icon: <Home size={20} color={currentScreen === 'home' ? colors.primary : colors.text.secondary} />,
      onPress: onNavigateToHome,
    },
    {
      id: 'director',
      label: 'Director',
      icon: <Sparkles size={20} color={currentScreen === 'director' ? colors.primary : colors.text.secondary} />,
      onPress: onNavigateToDirector,
    },
    {
      id: 'agents',
      label: 'Agents',
      icon: <Users size={20} color={currentScreen === 'agents' ? colors.primary : colors.text.secondary} />,
      onPress: onNavigateToAgents,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <Settings size={20} color={currentScreen === 'settings' ? colors.primary : colors.text.secondary} />,
      onPress: onNavigateToSettings,
    },
  ];

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      items={items}
      activeItemId={currentScreen}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.black,
  },
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    borderRightWidth: 1,
    shadowColor: palette.black,
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
    // Add top padding to account for status bar (drawer is outside SafeAreaView)
    // iOS: 59pt for notched devices (iPhone X+), Android: use spacing
    paddingTop: Platform.OS === 'ios' ? 59 : spacing[4],
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: spacing[2],
    borderRadius: 8,
  },
  content: {
    flex: 1,
    paddingVertical: spacing[2],
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    marginHorizontal: spacing[2],
    borderRadius: 8,
  },
  navItemIcon: {
    marginRight: spacing[3],
  },
  navItemLabel: {
    fontSize: 16,
  },
  footer: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
  },
  footerText: {
    marginTop: spacing[3],
    textAlign: 'center',
    fontSize: 12,
  },
});
