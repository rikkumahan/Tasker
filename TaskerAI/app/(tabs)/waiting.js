import React from 'react';
import { View, StyleSheet } from 'react-native';
import { T } from '../../components/Theme';
import { UnifiedPageHeader } from '../../components/UnifiedPageHeader';

export default function WaitingScreen() {
  return (
    <View style={s.root}>
      <UnifiedPageHeader title="Waiting" subtitle="Items you're waiting on" />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
});
