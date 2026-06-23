// people.js — People tab screen. Web: 4-col grid. Mobile: 1-col list.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { T } from '../../components/Theme';
import { PeopleGrid } from '../../components/PeopleGrid';
import { UnifiedPageHeader } from '../../components/UnifiedPageHeader';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useTabBarPadding } from '../../hooks/useTabBarPadding';
import { PEOPLE } from '../../components/mockData';

export default function PeopleScreen() {
  const { isMobile, isTablet } = useBreakpoint();
  const tabBarPadding = useTabBarPadding();

  const numColumns = isMobile ? 1 : isTablet ? 2 : 3;

  return (
    <View style={s.root}>
      <UnifiedPageHeader
        title="People"
        subtitle="Contacts from your threads"
        badgeCount={PEOPLE.length}
      />
      <View style={s.gridWrap}>
        <PeopleGrid
          numColumns={numColumns}
          contentPaddingBottom={isMobile ? tabBarPadding : 0}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  gridWrap: { flex: 1, paddingHorizontal: T.sp6 },
});
