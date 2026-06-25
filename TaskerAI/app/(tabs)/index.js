import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useTabBarPadding } from '../../hooks/useTabBarPadding';
import AIPanel, { AIPanelProvider } from '../../components/AIPanel';
import { DailyBriefHero, TopPriorities, PeopleWaiting } from '../../components/DashboardCards';
import { UnifiedPageHeader } from '../../components/UnifiedPageHeader';
import { T } from '../../components/Theme';
import { PRIORITIES } from '../../components/mockData';
import { IconSparkle } from '../../components/Icons';
import useAuthStore from '../../store/authStore';

const dateString = new Date().toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
});

const TodayActions = () => {
  const signOut = useAuthStore((s) => s.signOut);
  return (
    <>
      <TouchableOpacity style={s.syncBtn} activeOpacity={0.75} onPress={signOut}>
        <Text style={s.syncText}>Sign Out</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.briefBtn} activeOpacity={0.85}>
        <IconSparkle size={13} color="white" />
        <Text style={s.briefText}>Brief me</Text>
      </TouchableOpacity>
    </>
  );
};

export default function TodayScreen() {
  const [selectedId, setSelectedId] = useState(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const tabBarPadding = useTabBarPadding();

  const selectedItem = useMemo(
    () => PRIORITIES.find(p => p.id === selectedId) ?? null,
    [selectedId],
  );

  const handleSelect = useCallback((id) => {
    setSelectedId(id);
    setPanelVisible(true);
  }, []);

  const handleClose = useCallback(() => {
    setPanelVisible(false);
    setSelectedId(null);
  }, []);

  return (
    <AIPanelProvider>
      <View style={s.root}>
        <UnifiedPageHeader
          title="Today"
          subtitle={dateString}
          rightActions={<TodayActions />}
        />

        {/* ── Scrollable Content ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[s.scrollContent, { paddingBottom: tabBarPadding }]}
          showsVerticalScrollIndicator={false}
        >
          <DailyBriefHero />
          <TopPriorities selectedId={selectedId} onSelect={handleSelect} />
          <PeopleWaiting />
        </ScrollView>

        {/* ── AI Modal Bottom Sheet ── */}
        <AIPanel
          visible={panelVisible}
          item={selectedItem}
          onClose={handleClose}
        />
      </View>
    </AIPanelProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  syncBtn: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
  },
  syncText:  { fontSize: T.textSm, fontWeight: '600', color: T.fg2 },
  briefBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: T.accent,
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
  },
  briefText:     { fontSize: T.textSm, fontWeight: '600', color: 'white' },
  scrollContent: { paddingHorizontal: T.sp6, paddingTop: T.sp2 },
});
