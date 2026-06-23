// ─────────────────────────────────────────────────────────────────────────────
// tasks.js — Tasks tab screen
// Web:    2-column layout → TaskList (flex 1) + TaskDetailPanel (480px inline)
// Mobile: single-column TaskList + AIPanel bottom sheet on row tap
// All tokens from DESIGN_SYSTEM.md via Theme.js.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import {
  View, StyleSheet, Platform,
} from 'react-native';
import { T } from '../../components/Theme';
import { TaskList } from '../../components/TaskList';
import { TaskDetailPanel } from '../../components/web/TaskDetailPanel';
import AIPanel from '../../components/AIPanel';
import { UnifiedPageHeader } from '../../components/UnifiedPageHeader';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useTabBarPadding } from '../../hooks/useTabBarPadding';
import { TASKS } from '../../components/mockData';



export default function TasksScreen() {
  const { isMobile } = useBreakpoint();
  const tabBarPadding = useTabBarPadding();
  const [selectedId, setSelectedId]     = useState(null);
  const [panelVisible, setPanelVisible] = useState(false);

  const selectedTask = TASKS.find(t => t.id === selectedId) ?? null;

  const handleSelect = useCallback((id) => {
    setSelectedId(id);
    if (isMobile) setPanelVisible(true);
  }, [isMobile]);

  const handleClose = useCallback(() => {
    setPanelVisible(false);
  }, []);

  // ── WEB: 2-column inline layout ──────────────────────────────────────────
  if (!isMobile) {
    return (
      <View style={ws.root}>
        <View style={ws.listCol}>
          <UnifiedPageHeader
            title="Tasks"
            subtitle="All actionable items from your threads"
            badgeCount={TASKS.length}
          />
          <View style={ws.listInner}>
            <TaskList selectedId={selectedId} onSelect={handleSelect} />
          </View>
        </View>
        <TaskDetailPanel selectedTask={selectedTask} onClose={handleClose} />
      </View>
    );
  }

  // ── MOBILE: single column + bottom sheet ─────────────────────────────────
  return (
    <View style={ms.root}>
      <UnifiedPageHeader
        title="Tasks"
        subtitle="All actionable items from your threads"
        badgeCount={TASKS.length}
      />
      <View style={ms.listWrap}>
        <TaskList
          selectedId={selectedId}
          onSelect={handleSelect}
          contentPaddingBottom={tabBarPadding}
        />
      </View>
      <AIPanel
        visible={panelVisible}
        item={selectedTask}
        onClose={handleClose}
      />
    </View>
  );
}

// ── Web styles ────────────────────────────────────────────────────────────────
const ws = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: T.bg,
    height: '100%',
  },
  listCol: {
    flex: 1,
    backgroundColor: T.bg,
    borderRightWidth: 1,
    borderRightColor: T.border,
  },
  listInner: {
    flex: 1,
    paddingHorizontal: T.sp6,         // 24px — §4
  },
});

// ── Mobile styles ─────────────────────────────────────────────────────────────
const ms = StyleSheet.create({
  root:     { flex: 1, backgroundColor: T.bg },
  listWrap: { flex: 1, paddingHorizontal: T.sp4 },  // 16px — §4
});
