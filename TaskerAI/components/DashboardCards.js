import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { T, PRIORITY_MAP } from './Theme';
import { METRICS, PRIORITIES, WAITING } from './mockData';
import { IconSparkle, IconStar } from './Icons';

// ─── Primitives ───────────────────────────────────────────────────────────────

export const PriorityBadge = ({ level }) => {
  const s = PRIORITY_MAP[level] ?? PRIORITY_MAP.medium;
  return (
    <View style={[prim.badge, { backgroundColor: s.bg }]}>
      <Text style={[prim.badgeText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
};

export const Avatar = ({ initials, priority, size = 32 }) => {
  const s = PRIORITY_MAP[priority] ?? { bg: T.warmSurface, fg: T.accent };
  return (
    <View style={[prim.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: s.bg }]}>
      <Text style={[prim.avatarText, { color: s.fg, fontSize: size * 0.34 }]}>{initials}</Text>
    </View>
  );
};

export const PriorityDot = ({ priority }) => {
  const color = PRIORITY_MAP[priority]?.dot ?? T.muted;
  return <View style={[prim.dot, { backgroundColor: color }]} />;
};

const prim = StyleSheet.create({
  badge:      { paddingHorizontal: 8, paddingVertical: 2, borderRadius: T.radiusPill },
  badgeText:  { fontSize: T.textXs, fontWeight: '600' },
  avatar:     { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700' },
  dot:        { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
});

// ─── Metric Card (BlurView-based glass effect) ────────────────────────────────

const MetricCard = ({ metric, isMobile }) => {
  const content = (
    <>
      <Text style={mc.value} numberOfLines={1} adjustsFontSizeToFit>{metric.value}</Text>
      <Text style={mc.label} numberOfLines={2}>{metric.label}</Text>
      <Text style={mc.sub} numberOfLines={1}>{metric.sub}</Text>
    </>
  );

  if (Platform.OS === 'android') {
    return (
      <View style={[mc.glass, isMobile && mc.glassMobile, mc.glassAndroid]}>
        {content}
      </View>
    );
  }

  return (
    <BlurView intensity={60} tint="light" style={[mc.glass, isMobile && mc.glassMobile]}>
      {content}
    </BlurView>
  );
};

const mc = StyleSheet.create({
  glass: {
    flex: 1, borderRadius: 12, padding: T.sp5,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  glassMobile: {
    padding: T.sp3, // Reduce padding on mobile (12px instead of 20px)
  },
  glassAndroid: {
    backgroundColor: T.glassFallbackBg,
    borderWidth: 1,
    borderColor: T.glassFallbackBorder,
  },
  value: { fontSize: 30, fontWeight: '700', color: T.fg, marginBottom: 4 }, // Removed fixed lineHeight to fix shrinks
  label: { fontSize: T.textSm, fontWeight: '600', color: T.fg, marginBottom: 2 },
  sub:   { fontSize: T.textXs, fontWeight: '500', color: T.accent },
});

// ─── Daily Brief Hero (BlurView + LinearGradient) ────────────────────────────

import { useBreakpoint } from '../hooks/useBreakpoint';

export const DailyBriefHero = ({ metrics, onRefresh, userName }) => {
  const { isMobile } = useBreakpoint();
  const currentMetrics = metrics || METRICS;
  const totalAttention = currentMetrics.find(m => m.label === 'Action Items')?.value || '0';

  return (
    <View style={hero.shadowOuter}>
      <View style={hero.wrapper}>
        <LinearGradient
          colors={T.heroGrad}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {Platform.OS === 'android' ? (
          <View style={[StyleSheet.absoluteFill, hero.androidBlurFallback]} />
        ) : (
          <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
        )}

        {/* Content sits on top of blur */}
        <View style={hero.content}>
          {/* Header row */}
          <View style={[hero.headerRow, isMobile && hero.headerRowMobile]}>
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text style={hero.eyebrow}>Daily Brief</Text>
              <Text style={hero.greeting}>Hello, {userName || 'User'}.</Text>
              <Text style={hero.subtitle}>{totalAttention} items need your attention today.</Text>
            </View>
            <TouchableOpacity style={hero.refreshBtn} activeOpacity={0.7} onPress={onRefresh}>
              <IconSparkle size={13} color={T.fg2} />
              <Text style={hero.refreshText}>Refresh</Text>
            </TouchableOpacity>
          </View>

          {/* Metric cards */}
          <View style={[hero.metricsRow, isMobile && hero.metricsRowMobile]}>
            {currentMetrics.map(m => <MetricCard key={m.label} metric={m} isMobile={isMobile} />)}
          </View>
        </View>
      </View>
    </View>
  );
};

const hero = StyleSheet.create({
  shadowOuter: {
    borderRadius: 16, marginBottom: T.sp8,
    backgroundColor: '#fff', // Need background to cast shadow on Android
    ...Platform.select({
      ios: { shadowColor: 'rgba(200,140,100,0.15)', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 32 },
      android: { elevation: 4 },
    }),
  },
  wrapper: {
    borderRadius: 16, overflow: 'hidden',
    minHeight: 180,
  },
  androidBlurFallback: {
    backgroundColor: T.heroFallbackBg,
  },
  content: { zIndex: 1 },
  headerRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: T.sp8, paddingTop: 28, marginBottom: T.sp5,
  },
  headerRowMobile: {
    paddingHorizontal: T.sp5,
  },
  eyebrow: {
    fontSize: T.textXs, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, color: T.accent, marginBottom: 5,
  },
  greeting: {
    fontSize: T.textXl, fontWeight: '700', color: T.fg,
    letterSpacing: -0.5, lineHeight: 28,
  },
  subtitle: { fontSize: T.textSm, color: T.fg2, marginTop: 4 },
  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1, borderColor: T.border,
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
  },
  refreshText: { fontSize: T.textXs, fontWeight: '600', color: T.fg2 },
  metricsRow: {
    flexDirection: 'row', gap: T.sp3,
    paddingHorizontal: T.sp8, paddingBottom: 28,
  },
  metricsRowMobile: {
    paddingHorizontal: T.sp5,
    gap: T.sp2, // reduce gap to 8px
  },
});

// ─── Priority Row ─────────────────────────────────────────────────────────────

const PRIORITY_ACTION = { urgent: 'Reply →', high: 'Review →', medium: 'Review →' };

export const PriorityRow = ({ item, selected, onPress, onToggleStar }) => {
  const actionLabel = PRIORITY_ACTION[item.priority] ?? 'View →';
  return (
    <Pressable
      onPress={() => onPress(item.id)}
      style={({ pressed }) => [
        row.container,
        selected && row.containerSelected,
        pressed && !selected && row.containerHover,
      ]}
    >
      {selected && <View style={row.accentBar} />}
      <PriorityDot priority={item.priority} />
      <Avatar initials={item.initials} priority={item.priority} size={32} />
      <View style={row.content}>
        <View style={row.topRow}>
          <Text style={[row.subject, selected && { fontWeight: '600' }]} numberOfLines={1}>
            {item.subject}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {onToggleStar && (
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  onToggleStar(item.id);
                }}
                activeOpacity={0.7}
                style={{ padding: 4, marginRight: -2 }}
              >
                <IconStar starred={item.is_starred} size={15} />
              </TouchableOpacity>
            )}
            <Text style={row.timeAgo}>{item.timeAgo}</Text>
          </View>
        </View>
        <View style={row.bottomRow}>
          <Text style={row.sender}>{item.assignedFrom}</Text>
          <PriorityBadge level={item.priority} />
          <TouchableOpacity
            onPress={() => onPress(item.id)}
            style={[row.actionBtn, selected && row.actionBtnSelected]}
            activeOpacity={0.8}
          >
            <Text style={[row.actionText, selected && row.actionTextSelected]}>
              {actionLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Pressable>
  );
};

const row = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11,
    paddingVertical: 13, paddingHorizontal: 16,
    backgroundColor: T.surface, position: 'relative',
  },
  containerSelected: { backgroundColor: '#F1F5F9' },
  containerHover:    { backgroundColor: 'rgba(255,232,222,0.30)' },
  accentBar: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    width: 3, backgroundColor: T.accent, borderRadius: 2,
  },
  content:    { flex: 1, minWidth: 0 },
  topRow:     { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 5 },
  subject:    { flex: 1, fontSize: T.textSm, fontWeight: '500', color: T.fg },
  timeAgo:    { fontSize: T.textXs, color: T.muted, fontWeight: '500', flexShrink: 0 },
  bottomRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sender:     { fontSize: T.textXs, color: T.muted },
  actionBtn: {
    marginLeft: 'auto', paddingHorizontal: 12, paddingVertical: 4,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 6,
  },
  actionBtnSelected: { backgroundColor: T.accent, borderColor: T.accent },
  actionText:        { fontSize: T.textXs, fontWeight: '600', color: T.fg2 },
  actionTextSelected:{ color: 'white' },
});

// ─── Top Priorities List ──────────────────────────────────────────────────────

export const TopPriorities = ({ selectedId, onSelect, data, onToggleStar }) => {
  const listData = data || PRIORITIES;
  return (
    <View style={lst.wrapper}>
      <View style={lst.header}>
        <Text style={lst.title}>Top Priorities</Text>
        <Text style={lst.count}>{listData.length} items</Text>
      </View>
      <View style={lst.card}>
        {listData.map((item, idx) => (
          <View key={item.id}>
            <PriorityRow
              item={item}
              selected={selectedId === item.id}
              onPress={onSelect}
              onToggleStar={onToggleStar}
            />
            {idx < listData.length - 1 && <View style={lst.divider} />}
          </View>
        ))}
      </View>
    </View>
  );
};

// ─── People Waiting List ──────────────────────────────────────────────────────

const WaitingRow = ({ item }) => (
  <View style={wt.row}>
    <View style={[wt.avatar, { backgroundColor: item.urgent ? '#fff1f2' : T.warmSurface }]}>
      <Text style={[wt.avatarText, { color: item.urgent ? T.danger : T.accent }]}>{item.initials}</Text>
    </View>
    <View style={wt.info}>
      <Text style={wt.name}>{item.person}</Text>
      <Text style={wt.role}>{item.role}</Text>
    </View>
    <View style={[wt.waitBadge, { backgroundColor: item.urgent ? '#fff1f2' : T.bg }]}>
      <Text style={[wt.waitText, { color: item.urgent ? T.danger : T.muted }]}>{item.waiting}</Text>
    </View>
    <TouchableOpacity style={wt.replyBtn} activeOpacity={0.75}>
      <Text style={wt.replyText}>Reply →</Text>
    </TouchableOpacity>
  </View>
);

export const PeopleWaiting = ({ data }) => {
  const listData = data || WAITING;
  return (
    <View style={wt.wrapper}>
      <View style={lst.header}>
        <Text style={lst.title}>People Waiting On You</Text>
        <Text style={lst.count}>{listData.length} people</Text>
      </View>
      <View style={wt.card}>
        {listData.map((w, idx) => (
          <View key={w.id}>
            <WaitingRow item={w} />
            {idx < listData.length - 1 && <View style={lst.divider} />}
          </View>
        ))}
      </View>
    </View>
  );
};

const lst = StyleSheet.create({
  wrapper: { marginBottom: T.sp8 },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.sp5 },
  title:   { fontSize: T.textBase, fontWeight: '700', color: T.fg, letterSpacing: -0.1 },
  count:   { fontSize: T.textXs, color: T.muted, fontWeight: '500' },
  card: {
    backgroundColor: T.surface,
    borderWidth: 1, borderColor: 'rgba(230,180,150,0.38)',
    borderRadius: T.radiusSm, overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: 'rgba(200,120,80,0.06)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 12 },
      android: { elevation: 2 },
    }),
  },
  divider: { height: 1, backgroundColor: T.borderSoft, marginLeft: 16 },
});

const wt = StyleSheet.create({
  wrapper: { marginBottom: T.sp8 },
  card: {
    backgroundColor: T.surface,
    borderWidth: 1, borderColor: 'rgba(147,168,230,0.35)',
    borderRadius: T.radiusLg, overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: 'rgba(100,130,200,0.08)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 16 },
      android: { elevation: 2 },
    }),
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: T.sp3,
    paddingVertical: T.sp4, paddingHorizontal: T.sp6,
  },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontSize: 11, fontWeight: '700' },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: T.textSm, fontWeight: '600', color: T.fg },
  role: { fontSize: T.textXs, color: T.muted },
  waitBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: T.radiusPill },
  waitText:  { fontSize: T.textXs, fontWeight: '600' },
  replyBtn: {
    backgroundColor: T.warmSurface, borderWidth: 1,
    borderColor: 'rgba(37,99,235,0.2)', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  replyText: { fontSize: T.textXs, fontWeight: '600', color: T.accent },
});
