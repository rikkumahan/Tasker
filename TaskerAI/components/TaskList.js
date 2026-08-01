// ─────────────────────────────────────────────────────────────────────────────
// TaskList — Search bar + filter chips + flat task list
// All tokens from DESIGN_SYSTEM.md via Theme.js. No hardcoded values.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  ScrollView, StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import { T } from './Theme';
import { PriorityRow } from './DashboardCards';
import { IconSparkle } from './Icons';
import { TASKS } from './mockData';
import useAppStore from '../store/appStore';

// ─── Search icon (magnifying glass) ──────────────────────────────────────────
const SearchIcon = ({ size = 16, color = T.muted }) => {
  // Simple SVG-less fallback — expo doesn't need SVG for a text icon
  return <Text style={{ fontSize: size, color, lineHeight: size + 2 }}>⌕</Text>;
};

// ─── TaskSearchBar ─────────────────────────────────────────────────────────────
// DESIGN_SYSTEM.md §3: Inter 14px/400 placeholder, 14px/500 typed
// §5: radius-sm 10px | §4: sp4 horizontal, sp3 vertical padding | §2: T.border

export const TaskSearchBar = ({ value, onChangeText, onClear }) => (
  <View style={sb.wrapper}>
    <View style={sb.iconLeft}>
      <SearchIcon size={15} color={T.muted} />
    </View>
    <TextInput
      style={sb.input}
      placeholder="Search tasks…"
      placeholderTextColor={T.muted}
      value={value}
      onChangeText={onChangeText}
      returnKeyType="search"
      autoCorrect={false}
      autoCapitalize="none"
    />
    {value.length > 0 && (
      <TouchableOpacity onPress={onClear} style={sb.clearBtn} activeOpacity={0.7}>
        <Text style={sb.clearText}>×</Text>
      </TouchableOpacity>
    )}
  </View>
);

const sb = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radiusSm,           // 10px — §5
    paddingHorizontal: T.sp4,           // 16px — §4
    paddingVertical: T.sp3 - 1,         // ~11px — §4
    marginBottom: T.sp3,
  },
  iconLeft: { marginRight: T.sp2 },
  input: {
    flex: 1,
    fontSize: T.textSm,                 // 14px — §3
    fontWeight: '500',                  // Medium — §3
    color: T.fg,
    padding: 0,
  },
  clearBtn: {
    marginLeft: T.sp2,
    width: 20, height: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  clearText: { fontSize: 18, color: T.muted, lineHeight: 20 },
});

// ─── FilterChips ──────────────────────────────────────────────────────────────
// DESIGN_SYSTEM.md §3: Inter 12px/600 | §5: radius-pill | §2: T.accent (active)
// §7: motionFast 150ms for active state transition

const CHIPS = [
  { key: 'all',      label: 'All'      },
  { key: 'priority', label: 'Priority' },
  { key: 'action',   label: 'Action'   },
  { key: 'starred',  label: 'Starred'  },
];

const Chip = ({ chip, active, onPress, count }) => (
  <TouchableOpacity
    onPress={() => onPress(chip.key)}
    activeOpacity={0.75}
    style={[fc.chip, active && fc.chipActive]}
  >
    <Text style={[fc.label, active && fc.labelActive]}>{chip.label}</Text>
    {count != null && (
      <View style={[fc.badge, active && fc.badgeActive]}>
        <Text style={[fc.badgeText, active && fc.badgeTextActive]}>{count}</Text>
      </View>
    )}
  </TouchableOpacity>
);

export const FilterChips = ({ active, onSelect, counts }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    style={fc.scroll}
    contentContainerStyle={fc.content}
  >
    {CHIPS.map(chip => (
      <Chip
        key={chip.key}
        chip={chip}
        active={active === chip.key}
        onPress={onSelect}
        count={counts[chip.key]}
      />
    ))}
  </ScrollView>
);

const fc = StyleSheet.create({
  scroll:      { marginBottom: T.sp3 },
  content:     { flexDirection: 'row', alignItems: 'center', gap: T.sp2, paddingBottom: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.sp1,
    paddingVertical: T.sp2,            // 8px — §4
    paddingHorizontal: T.sp3,          // 12px — §4
    borderRadius: T.radiusPill,        // pill — §5
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: 'transparent',
  },
  chipActive: {
    backgroundColor: 'rgba(242,103,60,0.10)',   // accent tint — §2
    borderColor: T.accent,
  },
  label:         { fontSize: T.textXs, fontWeight: '600', color: T.fg2 },  // §3
  labelActive:   { color: T.accent },
  badge: {
    backgroundColor: T.border,
    borderRadius: T.radiusPill,
    paddingHorizontal: 5, paddingVertical: 1,
    minWidth: 18, alignItems: 'center',
  },
  badgeActive:    { backgroundColor: T.accent },
  badgeText:      { fontSize: 10, fontWeight: '700', color: T.fg2 },
  badgeTextActive:{ color: 'white' },
});

// ─── EmptyState ───────────────────────────────────────────────────────────────
// DESIGN_SYSTEM.md §3: Inter 14px/600 heading, 14px/400 sub | §2: T.fg2 / T.muted

const EmptyState = ({ isSearch }) => (
  <View style={es.wrap}>
    <View style={es.iconWrap}>
      <IconSparkle size={28} color={T.muted} />
    </View>
    <Text style={es.heading}>
      {isSearch ? 'No tasks found' : 'All caught up!'}
    </Text>
    <Text style={es.sub}>
      {isSearch
        ? 'Try adjusting your search or filter'
        : 'No tasks in this category'}
    </Text>
  </View>
);

const es = StyleSheet.create({
  wrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  iconWrap:{ opacity: 0.35, marginBottom: T.sp4 },
  heading: { fontSize: T.textSm, fontWeight: '600', color: T.fg2, marginBottom: 4 }, // §3
  sub:     { fontSize: T.textSm, fontWeight: '400', color: T.muted },               // §3
});

// ─── TaskList ─────────────────────────────────────────────────────────────────
// Reuses PriorityRow 100% from DashboardCards — no new row component

const Divider = () => <View style={{ height: 1, backgroundColor: T.borderSoft, marginLeft: 16 }} />;

export const TaskList = ({
  selectedId, onSelect, contentPaddingBottom = 0,
  data, loading, onRefresh, refreshing
}) => {
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState('all');

  const sourceData = data || TASKS;

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return sourceData.filter(t => {
      let matchFilter = true;
      if (filter === 'priority') {
        matchFilter = t.priority === 'urgent' || t.priority === 'high';
      } else if (filter === 'action') {
        matchFilter = t.action_items && t.action_items.length > 0;
      } else if (filter === 'starred') {
        matchFilter = !!t.is_starred;
      }

      const matchSearch = !q
        || (t.title && t.title.toLowerCase().includes(q))
        || (t.subject && t.subject.toLowerCase().includes(q))
        || (t.assignedFrom && t.assignedFrom.toLowerCase().includes(q))
        || (t.project && t.project.toLowerCase().includes(q));
      return matchFilter && matchSearch;
    });
  }, [sourceData, search, filter]);

  const counts = useMemo(() => {
    let priority = 0;
    let action = 0;
    let starred = 0;
    sourceData.forEach(t => {
      if (t.priority === 'urgent' || t.priority === 'high') priority++;
      if (t.action_items && t.action_items.length > 0) action++;
      if (t.is_starred) starred++;
    });
    return {
      all: sourceData.length,
      priority,
      action,
      starred,
    };
  }, [sourceData]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 }}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  return (
    <View style={tl.root}>
      <TaskSearchBar
        value={search}
        onChangeText={setSearch}
        onClear={() => setSearch('')}
      />
      <FilterChips active={filter} onSelect={setFilter} counts={counts} />

      <FlatList
        data={filtered}
        keyExtractor={t => t.id}
        renderItem={({ item }) => {
          const toggleStar = useAppStore.getState().toggleStar;
          return (
            <PriorityRow
              item={item}
              selected={selectedId === item.id}
              onPress={onSelect}
              onToggleStar={toggleStar}
            />
          );
        }}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={<EmptyState isSearch={search.length > 0 || filter !== 'all'} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          filtered.length === 0
            ? { flex: 1 }
            : contentPaddingBottom > 0
              ? { paddingBottom: contentPaddingBottom }
              : null
        }
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing || false}
              onRefresh={onRefresh}
              colors={[T.accent]}
              tintColor={T.accent}
            />
          ) : undefined
        }
      />
    </View>
  );
};

const tl = StyleSheet.create({
  root: { flex: 1 },
});
