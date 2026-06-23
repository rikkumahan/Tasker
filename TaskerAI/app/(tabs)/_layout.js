// _layout.js — Tab navigator layout for mobile.
// Adds MobileHeader above tabs and frosted-glass tab bar background.

import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { T } from '../../components/Theme';
import {
  IconToday, IconTasks, IconWaiting, IconProjects, IconPeople,
} from '../../components/Icons';

// Frosted glass tab bar background using expo-blur
const TabBarBackground = () => {
  if (Platform.OS === 'android') {
    return (
      <View style={[
        StyleSheet.absoluteFill,
        { backgroundColor: T.surface, borderTopWidth: 1, borderTopColor: T.sidebarBorder }
      ]} />
    );
  }
  return (
    <BlurView
      intensity={80}
      tint="light"
      style={StyleSheet.absoluteFill}
    />
  );
};

export default function TabLayout() {
  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── Tab Navigator ── */}
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarBackground: () => <TabBarBackground />,
          tabBarStyle: {
            position: 'absolute',
            borderTopWidth: 1,
            borderTopColor: T.sidebarBorder,
            backgroundColor: 'transparent',
          },
          tabBarActiveTintColor:   T.accent,
          tabBarInactiveTintColor: T.muted,
          tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
          tabBarItemStyle:  { paddingTop: 4 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Today',
            tabBarIcon: ({ color, size }) => <IconToday size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="tasks"
          options={{
            title: 'Tasks',
            tabBarIcon: ({ color, size }) => <IconTasks size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="waiting"
          options={{
            title: 'Waiting',
            tabBarBadge: 4,
            tabBarIcon: ({ color, size }) => <IconWaiting size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="projects"
          options={{
            title: 'Projects',
            tabBarIcon: ({ color, size }) => <IconProjects size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="people"
          options={{
            title: 'People',
            tabBarIcon: ({ color, size }) => <IconPeople size={size} color={color} />,
          }}
        />
      </Tabs>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
});
