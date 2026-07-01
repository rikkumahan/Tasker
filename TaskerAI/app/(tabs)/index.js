import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useTabBarPadding } from '../../hooks/useTabBarPadding';
import AIPanel, { AIPanelProvider } from '../../components/AIPanel';
import { DailyBriefHero, TopPriorities, PeopleWaiting } from '../../components/DashboardCards';
import { UnifiedPageHeader } from '../../components/UnifiedPageHeader';
import { T } from '../../components/Theme';
import { IconSparkle } from '../../components/Icons';
import useAuthStore from '../../store/authStore';
import useAppStore from '../../store/appStore';

const dateString = new Date().toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
});

const TodayActions = ({ onSync, syncing }) => {
  return (
    <>
      <TouchableOpacity style={s.syncBtn} activeOpacity={0.75} onPress={onSync} disabled={syncing}>
        <Text style={s.syncText}>{syncing ? 'Syncing...' : 'Sync'}</Text>
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

  const session = useAuthStore(s => s.session);
  const { threads, loading, refreshing, fetchAll } = useAppStore();

  const priorities = useMemo(() => {
    return threads.filter(t => t.priority === 'urgent' || t.priority === 'high').slice(0, 5);
  }, [threads]);

  const waitingOn = useMemo(() => {
    return threads.filter(t => t.action_type === 'reply').slice(0, 4);
  }, [threads]);

  const formattedWaiting = useMemo(() => {
    return waitingOn.map(t => ({
      id: t.id,
      person: t.assignedFrom,
      initials: t.initials,
      role: t.project || 'General',
      waiting: t.timeAgo,
      urgent: t.priority === 'urgent'
    }));
  }, [waitingOn]);

  const metrics = useMemo(() => {
    const actionItems = threads.length;
    const waitingCount = threads.filter(t => t.action_type === 'reply').length;
    const unreadCount = threads.filter(t => !t.is_read).length;

    const urgentCount = threads.filter(t => t.priority === 'urgent').length;
    const waitingOver24h = threads.filter(t => t.action_type === 'reply' && t.timeAgo.endsWith('d')).length;

    return [
      { value: String(actionItems), label: 'Action Items', sub: `${urgentCount} urgent` },
      { value: String(waitingCount), label: 'Waiting On', sub: `${waitingOver24h} over 24h` },
      { value: String(unreadCount), label: 'Unread Threads', sub: 'in inbox' }
    ];
  }, [threads]);

  const selectedItem = useMemo(
    () => threads.find(p => p.id === selectedId) ?? null,
    [selectedId, threads],
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

  const userName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'User';

  if (loading && threads.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.bg }}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  return (
    <AIPanelProvider>
      <View style={s.root}>
        <UnifiedPageHeader
          title="Today"
          subtitle={dateString}
          rightActions={<TodayActions onSync={handleRefresh} syncing={refreshing} />}
        />

        {/* ── Scrollable Content ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[s.scrollContent, { paddingBottom: tabBarPadding }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[T.accent]}
              tintColor={T.accent}
            />
          }
        >
          <DailyBriefHero metrics={metrics} onRefresh={handleRefresh} userName={userName} />
          <TopPriorities selectedId={selectedId} onSelect={handleSelect} data={priorities} />
          <PeopleWaiting data={formattedWaiting} />
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
