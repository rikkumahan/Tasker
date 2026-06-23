// ─────────────────────────────────────────────────────────────────────────────
// WebShell — Web-only root layout shell
// Single responsibility: compose Sidebar + scrollable main content area
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Slot } from 'expo-router';
import Sidebar from './Sidebar';
import { T } from '../Theme';

export default function WebShell() {
  return (
    <View style={s.shell}>
      {/* ── Sidebar (fixed left, 240px) ── */}
      <Sidebar />

      {/* ── Main Content Area ── */}
      <View style={s.mainArea}>
        {/* Max-width container — 1200px centered */}
        <View style={s.contentWrap}>
          <Slot />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  shell: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: T.bg,  // #F8FAFC
    height: '100%',
  },
  mainArea: {
    flex: 1,
    backgroundColor: T.bg,
    alignItems: 'center',
  },
  contentWrap: {
    width: '100%',
    maxWidth: T.contentMaxW,        // 1200px
    flex: 1,
  },
});
