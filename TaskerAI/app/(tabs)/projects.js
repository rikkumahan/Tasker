import React from 'react';
import { View, StyleSheet } from 'react-native';
import { T } from '../../components/Theme';
import { UnifiedPageHeader } from '../../components/UnifiedPageHeader';

export default function ProjectsScreen() {
  return (
    <View style={s.root}>
      <UnifiedPageHeader title="Projects" subtitle="Your active projects" />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
});
