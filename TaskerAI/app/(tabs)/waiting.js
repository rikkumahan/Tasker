import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Text } from 'react-native';
import { T } from '../../components/Theme';
import { UnifiedPageHeader } from '../../components/UnifiedPageHeader';
import { PriorityRow } from '../../components/DashboardCards';
import AIPanel, { AIPanelProvider } from '../../components/AIPanel';
import useAppStore from '../../store/appStore';
import { useTabBarPadding } from '../../hooks/useTabBarPadding';
import { IconSparkle } from '../../components/Icons';

const Divider = () => <View style={{ height: 1, backgroundColor: T.borderSoft, marginLeft: 16 }} />;

const EmptyState = () => (
  <View style={es.wrap}>
    <View style={es.iconWrap}>
      <IconSparkle size={28} color={T.muted} />
    </View>
    <Text style={es.heading}>All caught up!</Text>
    <Text style={es.sub}>No threads awaiting your response.</Text>
  </View>
);

const es = StyleSheet.create({
  wrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  iconWrap:{ opacity: 0.35, marginBottom: T.sp4 },
  heading: { fontSize: T.textSm, fontWeight: '600', color: T.fg2, marginBottom: 4 },
  sub:     { fontSize: T.textSm, fontWeight: '400', color: T.muted },
});

export default function WaitingScreen() {
  const [selectedId, setSelectedId] = useState(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const tabBarPadding = useTabBarPadding();

  const { threads, loading, refreshing, fetchAll, toggleStar } = useAppStore();

  // Filter threads where action_type === 'reply'
  const waitingThreads = useMemo(() => {
    return threads.filter(t => t.action_type === 'reply');
  }, [threads]);

  const selectedItem = useMemo(
    () => waitingThreads.find(t => t.id === selectedId) ?? null,
    [selectedId, waitingThreads]
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
          title="Waiting"
          subtitle="Threads requiring your response"
          badgeCount={waitingThreads.length}
        />
        <View style={s.listWrap}>
          <FlatList
            data={waitingThreads}
            keyExtractor={t => t.id}
            renderItem={({ item }) => (
              <PriorityRow
                item={item}
                selected={selectedId === item.id}
                onPress={handleSelect}
                onToggleStar={toggleStar}
              />
            )}
            ItemSeparatorComponent={Divider}
            ListEmptyComponent={<EmptyState />}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={
              waitingThreads.length === 0
                ? { flex: 1 }
                : { paddingBottom: tabBarPadding }
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                colors={[T.accent]}
                tintColor={T.accent}
              />
            }
          />
        </View>
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
  listWrap: { flex: 1, paddingHorizontal: T.sp4 },
});
