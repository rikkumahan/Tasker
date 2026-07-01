// people.js — People tab screen. Web: 4-col grid. Mobile: 1-col list.

import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { T } from '../../components/Theme';
import { PeopleGrid } from '../../components/PeopleGrid';
import { UnifiedPageHeader } from '../../components/UnifiedPageHeader';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useTabBarPadding } from '../../hooks/useTabBarPadding';
import useAppStore from '../../store/appStore';

export default function PeopleScreen() {
  const { isMobile, isTablet } = useBreakpoint();
  const tabBarPadding = useTabBarPadding();

  const { contacts, loading, refreshing, fetchAll } = useAppStore();

  const numColumns = isMobile ? 1 : isTablet ? 2 : 3;

  const handleRefresh = useCallback(() => {
    fetchAll(true);
  }, [fetchAll]);

  return (
    <View style={s.root}>
      <UnifiedPageHeader
        title="People"
        subtitle="Contacts from your threads"
        badgeCount={contacts.length}
      />
      <View style={s.gridWrap}>
        <PeopleGrid
          numColumns={numColumns}
          contentPaddingBottom={isMobile ? tabBarPadding : 0}
          data={contacts}
          loading={loading}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  gridWrap: { flex: 1, paddingHorizontal: T.sp6 },
});
