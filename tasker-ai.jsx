/**
 * tasker-ai.jsx — Tasker AI · Single-file React Native Reference
 *
 * Stack
 *   Expo SDK (iOS · Android · Web)   NativeWind v4   React Navigation v6
 *   @gorhom/bottom-sheet             @callstack/liquid-glass
 *   expo-linear-gradient             react-native-svg
 *
 * Install
 *   npx expo install @react-navigation/native @react-navigation/bottom-tabs
 *   npx expo install react-native-screens react-native-safe-area-context
 *   npx expo install @gorhom/bottom-sheet react-native-gesture-handler react-native-reanimated
 *   npx expo install @callstack/liquid-glass
 *   npx expo install expo-linear-gradient
 *   npx expo install react-native-svg
 *   npm install nativewind
 *
 * Entry: wrap App in GestureHandlerRootView + NavigationContainer in index.js
 */

import React, { useState, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TouchableHighlight,
  StyleSheet,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { LiquidGlass } from '@callstack/liquid-glass';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Path, Rect, Circle, Polygon, Line } from 'react-native-svg';

// ─────────────────────────────────────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  // Core palette
  bg:          '#F8FAFC',
  surface:     '#ffffff',
  fg:          '#111827',
  fg2:         '#374151',
  muted:       '#6B7280',
  border:      '#E5E7EB',
  borderSoft:  '#F3F4F6',

  // Accent
  accent:      '#F2673C',
  cta:         '#FB923C',
  ctaHover:    '#F97316',

  // Warm surfaces (AI Panel, reply cards)
  warmSurface: '#FFF8F5',
  warmBorder:  '#FFE4D9',

  // Status
  success: '#16a34a',
  warn:    '#f59e0b',
  danger:  '#ef4444',

  // Semantic surfaces used by priority rows
  urgentBg:    '#fff1f2',
  urgentFg:    '#dc2626',
  highBg:      '#fffbeb',
  highFg:      '#d97706',
  mediumBg:    '#f0fdf4',
  mediumFg:    '#16a34a',

  // Hero gradient colors (peach → soft-purple → lavender)
  heroGrad: [
    'rgba(255,241,236,0.60)',
    'rgba(249,237,255,0.55)',
    'rgba(237,233,254,0.60)',
  ] as const,

  // Logo gradient
  logoGrad: ['#F2673C', '#ea580c'] as const,

  // Glass intensity for LiquidGlass (0–1)
  glassIntensityHero:   0.55,
  glassIntensityMetric: 0.62,
  glassIntensitySidebar: 0.76,

  // Typography scale (sp / pt)
  textXs:   12,
  textSm:   14,
  textBase: 16,
  textLg:   18,
  textXl:   24,

  // Radii
  radiusSm:   10,
  radiusMd:   16,
  radiusLg:   24,
  radiusPill: 9999,

  // Spacing
  sp1: 4,
  sp2: 8,
  sp3: 12,
  sp4: 16,
  sp5: 20,
  sp6: 24,
  sp8: 32,
};

// ─────────────────────────────────────────────────────────────────────────────
// MOCK DATA
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITIES = [
  {
    id: 'p1',
    title: 'Review Series A pitch deck',
    subject: 'Pitch deck v2 — please review slides 8–12 before Thursday',
    timeAgo: '2h',
    initials: 'SC',
    project: 'Series A',
    priority: 'urgent',
    due: 'Today, 5:00 PM',
    assignedFrom: 'Sarah Chen',
    senderEmail: 'sarah.chen@company.com',
    action: 'Open deck and add comments to slides 8–12',
    aiSummary:
      'Sarah sent an updated version 2 hours ago. The deck has 18 slides — slides 8–12 cover financial projections that she flagged as needing your sign-off before the Sequoia call Thursday.',
    aiContext:
      'Sequoia meeting is Thursday at 11am. This is the second revision. Your main feedback last time was on the TAM slide and revenue model. Sarah addressed the TAM but revenue model is largely unchanged.',
    relatedPeople: ['Sarah Chen', 'James Okonkwo (CFO)'],
    suggestedReply:
      'Hey Sarah — will get you feedback on slides 8–12 by EOD today. Might have a question on the revenue assumptions, will flag in comments.',
  },
  {
    id: 'p2',
    title: 'Respond to Marcos on partnership terms',
    subject: 'Re: Term sheet revisions — IP clause in section 4 needs response',
    timeAgo: '1d',
    initials: 'MR',
    project: 'Partnerships',
    priority: 'high',
    due: 'Tomorrow, 12:00 PM',
    assignedFrom: 'Marcos Rivera',
    senderEmail: 'marcos.r@ventures.io',
    action: 'Draft response covering IP clauses in section 4',
    aiSummary:
      'Marcos sent term sheet revisions yesterday. The key sticking point is section 4 (IP ownership for co-developed integrations). He has a board meeting Friday and needs terms locked by Thursday.',
    aiContext:
      "Previous thread shows you agreed in principle to shared IP but your lawyer flagged joint ownership complications. Lisa (Legal) suggested a licensing model instead.",
    relatedPeople: ['Marcos Rivera', 'Lisa Tran (Legal)'],
    suggestedReply:
      "Marcos — looping in Lisa to finalize the IP language in section 4. We're aligned on the licensing approach and should have clean terms to you by Thursday morning.",
  },
  {
    id: 'p3',
    title: 'Approve Q3 budget proposal',
    subject: 'Q3 Budget Proposal ($2.4M) — awaiting your approval',
    timeAgo: '3h',
    initials: 'DP',
    project: 'Operations',
    priority: 'high',
    due: 'Today, 3:00 PM',
    assignedFrom: 'David Park',
    senderEmail: 'david.park@internal.co',
    action: 'Review budget doc and approve or leave blocking comments',
    aiSummary:
      "David submitted the Q3 budget this morning. Total ask is $2.4M — up 18% from Q2. The increase is driven by 3 new hires and the AWS infrastructure expansion.",
    aiContext:
      'Your Q2 actuals came in 6% under budget. The board expects a lean Q3 given macro conditions. David added a "stretch" scenario at $2.7M that you probably want to deprioritize.',
    relatedPeople: ['David Park (Finance)', 'Board (audit copy)'],
    suggestedReply:
      "David — approving the base Q3 budget. Holding off on the stretch scenario for now. Let's connect if the AWS timeline shifts.",
  },
  {
    id: 'p4',
    title: 'Finalize VP Sales hiring rubric',
    subject: 'VP Sales rubric — section 3 still empty, interviews start Monday',
    timeAgo: '5h',
    initials: 'AT',
    project: 'Hiring',
    priority: 'medium',
    due: 'Friday',
    assignedFrom: 'Amanda Torres',
    senderEmail: 'amanda.t@internal.co',
    action: 'Complete scorecard criteria section before first interviews',
    aiSummary:
      'Amanda shared a draft rubric for VP Sales. Cultural-fit and leadership sections are complete. Section 3 (sales competencies) is blank and 4 interviews are scheduled next Monday.',
    aiContext:
      'You mentioned wanting someone who has sold $1M+ deals and managed a 10+ person team. The last VP Sales lasted 8 months — post-mortem flagged "misaligned on enterprise vs. PLG motion" as the main issue.',
    relatedPeople: ['Amanda Torres (HR)', 'Priya Mehta (Panel lead)'],
    suggestedReply:
      "Amanda — I'll fill in section 3 by Thursday EOD. Key criteria: $1M+ ACV experience, managed 10+ AEs, enterprise-first motion preferred.",
  },
];

const WAITING = [
  { id: 'w1', person: 'Sarah Chen',    initials: 'SC', role: 'Head of Design', waiting: '2 days',  project: 'Series A',    action: 'Review pitch deck slides 8–12',      urgent: true  },
  { id: 'w2', person: 'Marcos Rivera', initials: 'MR', role: 'Partner, BD',   waiting: '1 day',   project: 'Partnerships', action: 'Respond to IP clause in section 4', urgent: true  },
  { id: 'w3', person: 'David Park',    initials: 'DP', role: 'Finance Lead',   waiting: '3 hours', project: 'Operations',   action: 'Approve Q3 budget document',        urgent: false },
  { id: 'w4', person: 'Amanda Torres', initials: 'AT', role: 'People Ops',     waiting: '5 hours', project: 'Hiring',       action: 'Complete VP Sales rubric section 3', urgent: false },
];

const METRICS = [
  { value: '7', label: 'Action Items',   sub: '3 urgent'   },
  { value: '4', label: 'People Waiting', sub: '2 over 24h' },
  { value: '2', label: 'Due Today',      sub: 'by 5:00 PM' },
];

// ─────────────────────────────────────────────────────────────────────────────
// SVG ICONS  (react-native-svg)
// ─────────────────────────────────────────────────────────────────────────────

const IconToday = ({ size = 20, color = 'currentColor' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Circle cx="10" cy="10" r="7.5" stroke={color} strokeWidth="1.5" />
    <Path d="M10 6.5v4l2.5 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

const IconTasks = ({ size = 20, color = 'currentColor' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Rect x="3" y="4" width="5" height="5" rx="1" stroke={color} strokeWidth="1.5" />
    <Path d="M4.5 6.5l1.5 1.5 2-2" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M11 6.5h6M11 13.5h6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <Rect x="3" y="11" width="5" height="5" rx="1" stroke={color} strokeWidth="1.5" />
  </Svg>
);

const IconWaiting = ({ size = 20, color = 'currentColor' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Circle cx="7.5" cy="6.5" r="2.5" stroke={color} strokeWidth="1.5" />
    <Path d="M3 16.5c0-2.761 2.015-5 4.5-5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <Circle cx="14" cy="13" r="3.5" stroke={color} strokeWidth="1.5" />
    <Path d="M14 11.5v2l1 1" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

const IconProjects = ({ size = 20, color = 'currentColor' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Rect x="3" y="3" width="5.5" height="5.5" rx="1.5" stroke={color} strokeWidth="1.5" />
    <Rect x="11.5" y="3" width="5.5" height="5.5" rx="1.5" stroke={color} strokeWidth="1.5" />
    <Rect x="3" y="11.5" width="5.5" height="5.5" rx="1.5" stroke={color} strokeWidth="1.5" />
    <Rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.5" stroke={color} strokeWidth="1.5" />
  </Svg>
);

const IconPeople = ({ size = 20, color = 'currentColor' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Circle cx="7.5" cy="7" r="3" stroke={color} strokeWidth="1.5" />
    <Path d="M2.5 17c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <Path d="M13.5 5c1.38.447 2.5 1.62 2.5 3s-1.12 2.553-2.5 3M17.5 17c0-2.761-2.015-5-4.5-5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

const IconSparkle = ({ size = 16, color = 'currentColor' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Path d="M10 2.5l1.8 5.7 5.7 1.8-5.7 1.8L10 17.5l-1.8-5.7-5.7-1.8 5.7-1.8L10 2.5z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
  </Svg>
);

const IconClose = ({ size = 14, color = '#9CA3AF' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Path d="M5 5l10 10M15 5L5 15" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
  </Svg>
);

const IconCopy = ({ size = 13, color = 'white' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Rect x="7" y="7" width="10" height="10" rx="2" stroke={color} strokeWidth="1.5" />
    <Path d="M13 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

const IconCheck = ({ size = 10, color = 'white' }) => (
  <Svg width={size} height={size} viewBox="0 0 12 12" fill="none">
    <Path d="M2 6l3 3 5-5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const IconExternalLink = ({ size = 13, color = '#9CA3AF' }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Path d="M11 3h6m0 0v6m0-6L8 12M6 5H4a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-2" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// Gmail M-envelope icon
const GmailIcon = ({ size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 48 48">
    <Path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75L35 40h7c1.657 0 3-1.343 3-3V16.2z" />
    <Path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6c-1.657 0-3-1.343-3-3V16.2z" />
    <Polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17" />
    <Path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859C9.132 8.301 8.228 8 7.298 8 4.924 8 3 9.924 3 12.298z" />
    <Path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341C38.868 8.301 39.772 8 40.702 8 43.076 8 45 9.924 45 12.298z" />
  </Svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_MAP = {
  urgent: { bg: '#fff1f2', fg: '#dc2626', label: 'Urgent', dot: '#ef4444' },
  high:   { bg: '#fffbeb', fg: '#d97706', label: 'High',   dot: '#f59e0b' },
  medium: { bg: '#f0fdf4', fg: '#16a34a', label: 'Medium', dot: '#16a34a' },
};

const PriorityBadge = ({ level }) => {
  const s = PRIORITY_MAP[level] ?? PRIORITY_MAP.medium;
  return (
    <View style={[prim.badge, { backgroundColor: s.bg }]}>
      <Text style={[prim.badgeText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
};

const Avatar = ({ initials, priority, size = 32 }) => {
  const s = PRIORITY_MAP[priority] ?? { bg: T.warmSurface, fg: T.accent };
  return (
    <View style={[prim.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: s.bg }]}>
      <Text style={[prim.avatarText, { color: s.fg, fontSize: size * 0.34 }]}>{initials}</Text>
    </View>
  );
};

const PriorityDot = ({ priority }) => {
  const color = PRIORITY_MAP[priority]?.dot ?? T.muted;
  return <View style={[prim.dot, { backgroundColor: color }]} />;
};

const SectionLabel = ({ children }) => (
  <Text style={prim.sectionLabel}>{children}</Text>
);

const prim = StyleSheet.create({
  badge:       { paddingHorizontal: 8, paddingVertical: 2, borderRadius: T.radiusPill },
  badgeText:   { fontSize: T.textXs, fontWeight: '600' },
  avatar:      { alignItems: 'center', justifyContent: 'center' },
  avatarText:  { fontWeight: '700' },
  dot:         { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  sectionLabel:{ fontSize: T.textXs, fontWeight: '600', color: T.fg2, letterSpacing: 0.1, marginBottom: 8 },
});

// ─────────────────────────────────────────────────────────────────────────────
// DAILY BRIEF HERO  (LiquidGlass + LinearGradient layered)
// ─────────────────────────────────────────────────────────────────────────────
//
// Pattern: LiquidGlass provides the backdrop blur / glass material.
//          LinearGradient sits as absoluteFill inside it for the color wash.
//          Metric cards use a second, nested LiquidGlass for the inner glass.
//
// @callstack/liquid-glass API:
//   <LiquidGlass style={...} intensity={0–1} cornerRadius={...}>
//     ...children
//   </LiquidGlass>
//
// intensity maps to the amount of blur + refraction applied by the native material.
// On Android, it falls back to a tinted surface (the library handles this internally).

const MetricCard = ({ metric }) => (
  <LiquidGlass
    intensity={T.glassIntensityMetric}
    cornerRadius={8}
    style={hero.metricGlass}
  >
    <Text style={hero.metricValue}>{metric.value}</Text>
    <Text style={hero.metricLabel}>{metric.label}</Text>
    <Text style={hero.metricSub}>{metric.sub}</Text>
  </LiquidGlass>
);

const DailyBriefHero = () => (
  <LiquidGlass
    intensity={T.glassIntensityHero}
    cornerRadius={12}
    style={hero.glass}
  >
    {/* Peach → soft-purple → lavender color wash */}
    <LinearGradient
      colors={T.heroGrad}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />

    {/* Header row */}
    <View style={hero.headerRow}>
      <View>
        <Text style={hero.eyebrow}>Daily Brief</Text>
        <Text style={hero.greeting}>Good morning, Sai.</Text>
        <Text style={hero.subtitle}>7 items need your attention today.</Text>
      </View>
      <TouchableOpacity style={hero.refreshBtn} activeOpacity={0.7}>
        <IconSparkle size={13} color={T.fg2} />
        <Text style={hero.refreshText}>Refresh</Text>
      </TouchableOpacity>
    </View>

    {/* Metric cards row */}
    <View style={hero.metricsRow}>
      {METRICS.map(m => <MetricCard key={m.label} metric={m} />)}
    </View>
  </LiquidGlass>
);

const hero = StyleSheet.create({
  glass: {
    borderRadius: 12,
    marginBottom: T.sp8,
    overflow: 'hidden',
    // Shadow underneath the hero card
    ...Platform.select({
      ios: { shadowColor: 'rgba(200,140,100,0.10)', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 32 },
      android: { elevation: 4 },
    }),
  },
  // Padding is set on an inner View so it sits on top of the gradient
  headerRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: T.sp8, paddingTop: 28, marginBottom: T.sp5,
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
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
  },
  refreshText: { fontSize: T.textXs, fontWeight: '600', color: T.fg2 },
  metricsRow: {
    flexDirection: 'row', gap: T.sp3,
    paddingHorizontal: T.sp8, paddingBottom: 28,
  },
  metricGlass: {
    flex: 1, borderRadius: 8, padding: T.sp5,
  },
  metricValue: { fontSize: 30, fontWeight: '700', color: T.fg, lineHeight: 34, marginBottom: 4 },
  metricLabel: { fontSize: T.textSm, fontWeight: '600', color: T.fg, marginBottom: 2 },
  metricSub:   { fontSize: T.textXs, fontWeight: '500', color: T.accent },
});

// ─────────────────────────────────────────────────────────────────────────────
// PRIORITY ROW  (Top Priorities section)
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_ACTION = { urgent: 'Reply →', high: 'Review →', medium: 'Review →' };

const PriorityRow = ({ item, selected, onPress }) => {
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
      {/* Left accent bar when selected */}
      {selected && <View style={row.accentBar} />}

      <PriorityDot priority={item.priority} />
      <Avatar initials={item.initials} priority={item.priority} size={32} />

      <View style={row.content}>
        {/* Subject + time */}
        <View style={row.topRow}>
          <Text style={[row.subject, selected && { fontWeight: '600' }]} numberOfLines={1}>
            {item.subject}
          </Text>
          <Text style={row.timeAgo}>{item.timeAgo}</Text>
        </View>

        {/* Sender + badge + action button */}
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

// ─────────────────────────────────────────────────────────────────────────────
// TOP PRIORITIES LIST
// ─────────────────────────────────────────────────────────────────────────────

const TopPriorities = ({ selectedId, onSelect }) => (
  <View style={list.wrapper}>
    <View style={list.header}>
      <Text style={list.title}>Top Priorities</Text>
      <Text style={list.count}>4 items</Text>
    </View>
    <View style={list.card}>
      {PRIORITIES.map((item, idx) => (
        <View key={item.id}>
          <PriorityRow
            item={item}
            selected={selectedId === item.id}
            onPress={onSelect}
          />
          {idx < PRIORITIES.length - 1 && <View style={list.divider} />}
        </View>
      ))}
    </View>
  </View>
);

const list = StyleSheet.create({
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

// ─────────────────────────────────────────────────────────────────────────────
// PEOPLE WAITING LIST  (scrollable rows)
// ─────────────────────────────────────────────────────────────────────────────

const WaitingRow = ({ item }) => (
  <View style={wt.row}>
    {/* Avatar */}
    <View style={[wt.avatar, { backgroundColor: item.urgent ? '#fff1f2' : T.warmSurface }]}>
      <Text style={[wt.avatarText, { color: item.urgent ? T.danger : T.accent }]}>{item.initials}</Text>
    </View>

    {/* Person info */}
    <View style={wt.info}>
      <Text style={wt.name}>{item.person}</Text>
      <Text style={wt.role}>{item.role}</Text>
    </View>

    {/* Waiting badge */}
    <View style={[wt.waitBadge, { backgroundColor: item.urgent ? '#fff1f2' : T.bg }]}>
      <Text style={[wt.waitText, { color: item.urgent ? T.danger : T.muted }]}>{item.waiting}</Text>
    </View>

    {/* Reply button */}
    <TouchableOpacity style={wt.replyBtn} activeOpacity={0.75}>
      <Text style={wt.replyText}>Reply →</Text>
    </TouchableOpacity>
  </View>
);

const PeopleWaiting = () => (
  <View style={wt.wrapper}>
    <View style={list.header}>
      <Text style={list.title}>People Waiting On You</Text>
      <Text style={list.count}>4 people</Text>
    </View>
    <View style={wt.card}>
      {WAITING.map((w, idx) => (
        <View key={w.id}>
          <WaitingRow item={w} />
          {idx < WAITING.length - 1 && <View style={list.divider} />}
        </View>
      ))}
    </View>
  </View>
);

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

// ─────────────────────────────────────────────────────────────────────────────
// AI PANEL  (BottomSheet — triggered from priority row tap)
// ─────────────────────────────────────────────────────────────────────────────
//
// Renders a @gorhom/bottom-sheet modal at 85% screen height.
// Matches the desktop right-side panel layout adapted for mobile:
//   - Email-style header (Gmail icon · subject · priority badge · close)
//   - Sender meta row
//   - Scrollable body: AI Summary, Suggested Action (checkbox), Context, People, Reply
//   - Inline "Use Reply" CTA in the reply section header (replaces footer buttons)

const PRIORITY_PANEL_META = {
  urgent: { bg: '#FEF2F2', fg: '#DC2626', border: '#FECACA', label: 'URGENT' },
  high:   { bg: '#FFF7ED', fg: '#EA580C', border: '#FED7AA', label: 'HIGH'   },
  medium: { bg: '#EFF6FF', fg: '#2563EB', border: '#BFDBFE', label: 'MEDIUM' },
  low:    { bg: '#F0FDF4', fg: '#16A34A', border: '#BBF7D0', label: 'LOW'    },
};

const AIPanel = ({ item, onClose, bottomSheetRef }) => {
  const [actionDone, setActionDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const snapPoints = useMemo(() => ['85%'], []);

  const handleCopy = useCallback(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const pm = PRIORITY_PANEL_META[item?.priority] ?? PRIORITY_PANEL_META.medium;

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={item ? 0 : -1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={panel.sheetBg}
      handleIndicatorStyle={panel.handle}
    >
      {item && (
        <>
          {/* ── Email-style header ── */}
          <View style={panel.headerOuter}>
            {/* Row 1: Gmail icon · subject · priority badge · open · close */}
            <View style={panel.headerRow}>
              <GmailIcon size={20} />
              <Text style={panel.subject} numberOfLines={2}>{item.subject}</Text>
              <View style={[panel.priorityBadge, { backgroundColor: pm.bg, borderColor: pm.border }]}>
                <Text style={[panel.priorityBadgeText, { color: pm.fg }]}>{pm.label}</Text>
              </View>
              <TouchableOpacity style={panel.iconBtn} onPress={() => {}}>
                <IconExternalLink size={13} color="#9CA3AF" />
              </TouchableOpacity>
              <TouchableOpacity style={panel.iconBtn} onPress={onClose}>
                <IconClose size={13} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            {/* Row 2: sender · email · time */}
            <View style={panel.senderRow}>
              <Text style={panel.senderName}>{item.assignedFrom}</Text>
              <Text style={panel.senderMeta}> · {item.senderEmail} · {item.timeAgo} ago</Text>
            </View>
          </View>

          {/* ── Scrollable body ── */}
          <BottomSheetScrollView contentContainerStyle={panel.scrollContent}>

            {/* AI Summary */}
            <View style={panel.section}>
              <SectionLabel>AI Summary</SectionLabel>
              <View style={panel.summaryCard}>
                <Text style={panel.summaryText}>{item.aiSummary}</Text>
              </View>
            </View>

            {/* Suggested Action */}
            <View style={panel.section}>
              <SectionLabel>Suggested Action</SectionLabel>
              <TouchableOpacity
                onPress={() => setActionDone(!actionDone)}
                activeOpacity={0.8}
                style={[
                  panel.actionCard,
                  actionDone
                    ? { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }
                    : { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
                ]}
              >
                {/* Checkbox */}
                <View style={[panel.checkbox, actionDone && panel.checkboxDone]}>
                  {actionDone && <IconCheck size={10} color="white" />}
                </View>
                <Text style={[
                  panel.actionText,
                  { color: actionDone ? '#15803D' : '#92400E' },
                  actionDone && { textDecorationLine: 'line-through' },
                ]}>
                  {item.action}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Important Context */}
            <View style={panel.section}>
              <SectionLabel>Important Context</SectionLabel>
              <View style={panel.contextCard}>
                <Text style={panel.contextText}>{item.aiContext}</Text>
              </View>
            </View>

            {/* Related People */}
            <View style={panel.section}>
              <SectionLabel>Related People</SectionLabel>
              <View style={panel.chipsRow}>
                {item.relatedPeople.map(p => (
                  <View key={p} style={panel.chip}>
                    <Text style={panel.chipText}>{p}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Suggested Reply */}
            <View style={panel.section}>
              <View style={panel.replyHeaderRow}>
                <SectionLabel>Suggested Reply</SectionLabel>
                {/* "Use Reply" CTA — inline, replaces scroll-to-footer pattern */}
                <TouchableOpacity
                  onPress={handleCopy}
                  activeOpacity={0.85}
                  style={[panel.useReplyBtn, copied && { backgroundColor: T.success }]}
                >
                  {!copied && <IconCopy size={13} color="white" />}
                  <Text style={panel.useReplyText}>{copied ? '✓ Copied!' : 'Use Reply'}</Text>
                </TouchableOpacity>
              </View>
              <View style={panel.replyCard}>
                <Text style={panel.replyText}>{item.suggestedReply}</Text>
              </View>
            </View>

          </BottomSheetScrollView>
        </>
      )}
    </BottomSheet>
  );
};

const panel = StyleSheet.create({
  sheetBg:   { backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle:    { backgroundColor: T.border, width: 36, height: 4 },

  headerOuter: {
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 13,
    borderBottomWidth: 1, borderBottomColor: T.border,
    backgroundColor: '#FAFAFA',
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  subject: {
    flex: 1, fontSize: 13, fontWeight: '700', color: '#111827',
    lineHeight: 18, minWidth: 0,
  },
  priorityBadge: {
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 5, borderWidth: 1,
    flexShrink: 0,
  },
  priorityBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  iconBtn:   { padding: 4, flexShrink: 0 },

  senderRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 7, marginLeft: 29 },
  senderName: { fontSize: 12, fontWeight: '600', color: '#374151' },
  senderMeta: { fontSize: 12, color: '#9CA3AF' },

  scrollContent: { padding: 20, gap: 20 },
  section: { gap: 0 },

  summaryCard: {
    backgroundColor: T.warmSurface, borderWidth: 1, borderColor: T.warmBorder,
    borderRadius: 10, padding: 14,
  },
  summaryText: { fontSize: 13, color: T.fg2, lineHeight: 21 },

  actionCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11,
    borderWidth: 1, borderRadius: 10, padding: 14,
  },
  checkbox: {
    width: 18, height: 18, borderRadius: 4, borderWidth: 2,
    borderColor: '#D1D5DB', backgroundColor: 'white',
    alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0,
  },
  checkboxDone: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
  actionText: { fontSize: 13, lineHeight: 20, flex: 1 },

  contextCard: {
    borderLeftWidth: 3, borderLeftColor: T.accent,
    backgroundColor: T.warmSurface,
    borderTopRightRadius: 8, borderBottomRightRadius: 8,
    padding: 14,
  },
  contextText: { fontSize: 13, color: '#374151', lineHeight: 21 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusPill, paddingHorizontal: 12, paddingVertical: 5,
  },
  chipText: { fontSize: 12, fontWeight: '500', color: '#374151' },

  replyHeaderRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  useReplyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: T.cta, borderRadius: 7,
    paddingHorizontal: 13, paddingVertical: 7,
  },
  useReplyText: { fontSize: 12, fontWeight: '600', color: 'white' },
  replyCard: {
    backgroundColor: T.warmSurface, borderWidth: 1, borderColor: T.warmBorder,
    borderRadius: 10, padding: 14,
  },
  replyText: { fontSize: 13, color: T.fg2, lineHeight: 21 },
});

// ─────────────────────────────────────────────────────────────────────────────
// TODAY SCREEN  (main content + AI panel bottom sheet)
// ─────────────────────────────────────────────────────────────────────────────

const TodayScreen = () => {
  const [selectedId, setSelectedId] = useState(null);
  const bottomSheetRef = useRef(null);
  const insets = useSafeAreaInsets();

  const selectedItem = useMemo(
    () => PRIORITIES.find(p => p.id === selectedId) ?? null,
    [selectedId],
  );

  const handleSelect = useCallback((id) => {
    setSelectedId(prev => (prev === id ? null : id));
    if (id) bottomSheetRef.current?.expand();
    else     bottomSheetRef.current?.close();
  }, []);

  const handleClose = useCallback(() => {
    setSelectedId(null);
    bottomSheetRef.current?.close();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={today.root} edges={['top']}>
        {/* ── Page header ── */}
        <View style={today.pageHeader}>
          <View>
            <Text style={today.pageTitle}>Today</Text>
            <Text style={today.pageDate}>Wednesday, June 18, 2026</Text>
          </View>
          <View style={today.headerActions}>
            <TouchableOpacity style={today.syncBtn} activeOpacity={0.75}>
              <Text style={today.syncText}>Sync</Text>
            </TouchableOpacity>
            <TouchableOpacity style={today.briefBtn} activeOpacity={0.85}>
              <IconSparkle size={13} color="white" />
              <Text style={today.briefText}>Brief Me</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Scrollable content ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[today.scrollContent, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
        >
          <DailyBriefHero />
          <TopPriorities selectedId={selectedId} onSelect={handleSelect} />
          <PeopleWaiting />
        </ScrollView>

        {/* ── AI Context Panel (modal bottom sheet) ── */}
        <AIPanel
          item={selectedItem}
          onClose={handleClose}
          bottomSheetRef={bottomSheetRef}
        />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
};

const today = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  pageHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: T.sp6, paddingTop: T.sp5, paddingBottom: T.sp5,
    borderBottomWidth: 1, borderBottomColor: 'rgba(230,180,150,0.30)',
  },
  pageTitle: { fontSize: T.textXl, fontWeight: '700', color: T.fg, letterSpacing: -0.5 },
  pageDate:  { fontSize: T.textSm, color: T.muted, marginTop: 4 },
  headerActions: { flexDirection: 'row', gap: T.sp3, alignItems: 'center' },
  syncBtn: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9,
  },
  syncText: { fontSize: T.textSm, fontWeight: '600', color: T.fg2 },
  briefBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: T.accent,
    borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9,
  },
  briefText: { fontSize: T.textSm, fontWeight: '600', color: 'white' },
  scrollContent: { paddingHorizontal: T.sp6, paddingTop: T.sp6 },
});

// ─────────────────────────────────────────────────────────────────────────────
// STUB SCREENS  (scaffold — replace with full implementations)
// ─────────────────────────────────────────────────────────────────────────────

const StubScreen = ({ label }) => (
  <View style={stub.root}>
    <Text style={stub.label}>{label}</Text>
    <Text style={stub.sub}>Coming soon</Text>
  </View>
);

const stub = StyleSheet.create({
  root:  { flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: T.textLg, fontWeight: '700', color: T.fg, marginBottom: 6 },
  sub:   { fontSize: T.textSm, color: T.muted },
});

const TasksScreen   = () => <StubScreen label="Tasks"    />;
const WaitingScreen = () => <StubScreen label="Waiting"  />;
const ProjectsScreen= () => <StubScreen label="Projects" />;
const PeopleScreen  = () => <StubScreen label="People"   />;

// ─────────────────────────────────────────────────────────────────────────────
// TAB NAVIGATOR
// ─────────────────────────────────────────────────────────────────────────────
//
// 5 tabs: Today · Tasks · Waiting · Projects · People
// Tab bar uses LiquidGlass for the frosted glass bar material on iOS.
// The tabBarBackground prop renders the glass surface behind the tab icons.

const Tab = createBottomTabNavigator();

const TabBarBackground = () => (
  <LiquidGlass
    intensity={T.glassIntensitySidebar}
    style={StyleSheet.absoluteFill}
    cornerRadius={0}
  />
);

const tabIcon = (Icon, color, size) => <Icon size={size} color={color} />;

const AppNavigator = () => (
  <NavigationContainer>
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarBackground: () => <TabBarBackground />,
        tabBarStyle: tabs.bar,
        tabBarActiveTintColor:   T.accent,
        tabBarInactiveTintColor: T.muted,
        tabBarLabelStyle: tabs.label,
        tabBarItemStyle:  tabs.item,
      }}
    >
      <Tab.Screen
        name="Today"
        component={TodayScreen}
        options={{ tabBarIcon: ({ color, size }) => tabIcon(IconToday, color, size) }}
      />
      <Tab.Screen
        name="Tasks"
        component={TasksScreen}
        options={{ tabBarIcon: ({ color, size }) => tabIcon(IconTasks, color, size) }}
      />
      <Tab.Screen
        name="Waiting"
        component={WaitingScreen}
        options={{
          tabBarBadge: 4,
          tabBarIcon: ({ color, size }) => tabIcon(IconWaiting, color, size),
        }}
      />
      <Tab.Screen
        name="Projects"
        component={ProjectsScreen}
        options={{ tabBarIcon: ({ color, size }) => tabIcon(IconProjects, color, size) }}
      />
      <Tab.Screen
        name="People"
        component={PeopleScreen}
        options={{ tabBarIcon: ({ color, size }) => tabIcon(IconPeople, color, size) }}
      />
    </Tab.Navigator>
  </NavigationContainer>
);

const tabs = StyleSheet.create({
  bar: {
    position: 'absolute',
    borderTopWidth: 1,
    borderTopColor: 'rgba(230,180,150,0.28)',
    // Height is handled by safe area insets automatically in React Navigation
  },
  label: { fontSize: 10, fontWeight: '600' },
  item:  { paddingTop: 4 },
});

// ─────────────────────────────────────────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  return <AppNavigator />;
}
