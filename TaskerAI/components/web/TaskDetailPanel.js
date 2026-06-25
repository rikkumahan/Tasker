// ─────────────────────────────────────────────────────────────────────────────
// TaskDetailPanel — Web-only inline right panel for Tasks tab
// Renders PanelContent from AIPanel.js (zero AI UI duplication).
// All tokens from DESIGN_SYSTEM.md via Theme.js.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { T } from '../Theme';
import { PanelContent } from '../AIPanel';
import { IconSparkle } from '../Icons';

// ─── Toggle Pill (AI ↔ Detail) ────────────────────────────────────────────────
// DESIGN_SYSTEM.md §3: Inter 12px/600 | §2: T.accent active, T.muted inactive
// §7: motionFast 150ms implied — state swaps immediately on press

const MODES = [
  { key: 'ai',     label: '✦ AI'    },
  { key: 'detail', label: 'Detail'  },
];

const TogglePill = ({ mode, onToggle }) => (
  <View style={tp.pill}>
    {MODES.map(m => (
      <TouchableOpacity
        key={m.key}
        onPress={() => onToggle(m.key)}
        activeOpacity={0.8}
        style={[tp.option, mode === m.key && tp.optionActive]}
      >
        <Text style={[tp.label, mode === m.key && tp.labelActive]}>
          {m.label}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

const tp = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    backgroundColor: T.bg,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radiusPill,        // pill — §5
    padding: 2,
  },
  option: {
    paddingHorizontal: T.sp3,          // 12px — §4
    paddingVertical: 4,
    borderRadius: T.radiusPill,
  },
  optionActive: { backgroundColor: T.accent },
  label:        { fontSize: T.textXs, fontWeight: '600', color: T.muted },    // §3
  labelActive:  { color: 'white' },
});

// ─── Empty State (no task selected) ──────────────────────────────────────────
// DESIGN_SYSTEM.md §3: Inter 16px/600 heading, 14px/400 sub | §2: T.fg2 / T.muted

const PanelEmptyState = () => (
  <View style={em.wrap}>
    <View style={em.iconWrap}>
      <IconSparkle size={32} color={T.muted} />
    </View>
    <Text style={em.heading}>Select a task</Text>
    <Text style={em.sub}>Click any task to see AI insights</Text>
  </View>
);

const em = StyleSheet.create({
  wrap:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconWrap:{ opacity: 0.4, marginBottom: T.sp4 },
  heading: { fontSize: T.textBase, fontWeight: '600', color: T.fg2, marginBottom: 6 }, // §3
  sub:     { fontSize: T.textSm, fontWeight: '400', color: T.muted },                  // §3
});

// ─── TaskDetailPanel ─────────────────────────────────────────────────────────
// DESIGN_SYSTEM.md §9: Panel sits as an inline sibling (no overlay/modal)
// Width: T.drawerW (480px) | Left border: T.sidebarBorder | bg: T.surface

export const TaskDetailPanel = ({ selectedTask, onClose }) => {
  const [mode, setMode] = useState('ai');

  return (
    <View style={p.panel}>
      {/* ── Header bar ── */}
      <View style={p.header}>
        <Text style={p.headerTitle} numberOfLines={1}>
          {selectedTask ? selectedTask.title : 'AI Panel'}
        </Text>
        <TogglePill mode={mode} onToggle={setMode} />
      </View>

      {/* ── Content ── */}
      {selectedTask ? (
        // Both "AI" and "Detail" modes show PanelContent for now.
        // Phase 2: replace the 'detail' branch with a native task detail view.
        <PanelContent item={selectedTask} onClose={onClose} />
      ) : (
        <PanelEmptyState />
      )}
    </View>
  );
};

const p = StyleSheet.create({
  panel: {
    width: T.drawerW,                          // 480px — §9
    flexShrink: 0,
    backgroundColor: T.surface,               // #ffffff — §2
    borderLeftWidth: 1,
    borderLeftColor: T.sidebarBorder,          // rgba(230,180,150,0.28) — §6 Sidebar Glass
    height: '100%',
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.sp6,                  // 24px — §4
    borderBottomWidth: 1,
    borderBottomColor: T.border,               // #E5E7EB — §2
  },
  headerTitle: {
    flex: 1,
    fontSize: T.textSm,                        // 14px — §3
    fontWeight: '600',
    color: T.fg,                               // #111827 — §2
    marginRight: T.sp4,
  },
});
