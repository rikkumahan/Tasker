// ─────────────────────────────────────────────────────────────────────────────
// tasks.js — Tasks tab screen
// Unified: single-column layout using sliding AIPanel overlay drawer on Web & Mobile
// All tokens from DESIGN_SYSTEM.md via Theme.js.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useMemo, useCallback } from 'react';
import {
  View, StyleSheet, Platform,
} from 'react-native';
import { T } from '../../components/Theme';
import { TaskList } from '../../components/TaskList';
import AIPanel, { AIPanelProvider } from '../../components/AIPanel';
import { UnifiedPageHeader } from '../../components/UnifiedPageHeader';
import { useTabBarPadding } from '../../hooks/useTabBarPadding';
import useAppStore from '../../store/appStore';

export default function TasksScreen() {
  const tabBarPadding = useTabBarPadding();
  const [selectedId, setSelectedId] = useState(null);
  const [panelVisible, setPanelVisible] = useState(false);

  const { threads, loading, refreshing, fetchAll } = useAppStore();

  const selectedTask = useMemo(
    () => threads.find(t => t.id === selectedId) ?? null,
    [selectedId, threads]
  );

  const handleSelect = useCallback((id) => {
    setSelectedId(id);
    setPanelVisible(true);
  }, []);

  const handleClose = useCallback(() => {
    setPanelVisible(false);
    setSelectedId(null);
  }, []);

  const handleRefresh = useCallback(() => {
    fetchAll(true);
  }, [fetchAll]);

  return (
    <AIPanelProvider>
      <View style={s.root}>
        <UnifiedPageHeader
          title="Tasks"
          subtitle="All actionable items from your threads"
          badgeCount={threads.length}
        />
        <View style={s.listWrap}>
          <TaskList
            selectedId={selectedId}
            onSelect={handleSelect}
            contentPaddingBottom={Platform.OS === 'web' ? 24 : tabBarPadding}
            data={threads}
            loading={loading}
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        </View>
        <AIPanel
          visible={panelVisible}
          item={selectedTask}
          onClose={handleClose}
        />
      </View>
    </AIPanelProvider>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: T.bg,
    height: '100%',
    ...Platform.select({
      web: { overflow: 'hidden' },
    }),
  },
  listWrap: {
    flex: 1,
    paddingHorizontal: Platform.OS === 'web' ? T.sp6 : T.sp4,
    height: '100%',
    ...Platform.select({
      web: { overflow: 'hidden' },
    }),
  },
});
