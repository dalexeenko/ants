import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  ThemeContext,
  useUIStore,
  IconButton,
  type ActiveScreen,
} from '../index';
import { usePluginScreens } from '../plugins';

export function IconRail() {
  const { colors } = React.useContext(ThemeContext);
  const { activeScreen, setActiveScreen, leftSidebarCollapsed, toggleLeftSidebar } = useUIStore();
  const pluginScreens = usePluginScreens();

  const handleIconClick = (screen: ActiveScreen) => {
    if (activeScreen === screen) {
      // Already on this screen, toggle sidebar
      toggleLeftSidebar();
    } else {
      // Switch to this screen and ensure sidebar is open
      setActiveScreen(screen);
      if (leftSidebarCollapsed) {
        toggleLeftSidebar();
      }
    }
  };

  return (
    <View testID="openmgr-icon-rail" style={[styles.iconRail, { backgroundColor: colors.bg.secondary, borderRightColor: colors.border.light }]}>
      <View style={styles.iconRailTop}>
        <IconButton
          testID="openmgr-icon-rail-projects"
          icon="folder"
          size="md"
          variant={activeScreen === 'project' ? 'default' : 'ghost'}
          onPress={() => handleIconClick('project')}
        />
        <IconButton
          testID="openmgr-icon-rail-director"
          icon="sparkles"
          size="md"
          variant={activeScreen === 'director' ? 'default' : 'ghost'}
          onPress={() => handleIconClick('director')}
        />
        <IconButton
          testID="openmgr-icon-rail-agents"
          icon="users"
          size="md"
          variant={activeScreen === 'agents' ? 'default' : 'ghost'}
          onPress={() => handleIconClick('agents')}
        />
        {/* Plugin-contributed screen icons */}
        {pluginScreens.map((screen) => (
          <IconButton
            key={screen.id}
            testID={`openmgr-icon-rail-plugin-${screen.id}`}
            icon={screen.icon as any}
            size="md"
            variant={activeScreen === screen.id ? 'default' : 'ghost'}
            onPress={() => handleIconClick(screen.id)}
          />
        ))}
      </View>
      <View style={styles.iconRailBottom}>
        <IconButton
          testID="openmgr-icon-rail-settings"
          icon="settings"
          size="md"
          variant={activeScreen === 'settings' ? 'default' : 'ghost'}
          onPress={() => handleIconClick('settings')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  iconRail: {
    width: 48,
    borderRightWidth: 1,
    paddingVertical: 8,
  },
  iconRailTop: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  iconRailBottom: {
    alignItems: 'center',
    gap: 4,
  },
});
