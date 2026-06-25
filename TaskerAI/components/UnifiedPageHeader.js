// UnifiedPageHeader — Smart page header for all tabs.
//
// Mobile: renders the full unified card:
//   ┌─────────────────────────────────────────┐
//   │  ⠿⠿⠿ TaskerAI                    [RM]  │  ← app row
//   │  ─────────────────────────────────────  │  ← divider
//   │  Today              [Sync] [✦ Brief me] │  ← page row
//   │  Monday, June 22, 2026                  │
//   └─────────────────────────────────────────┘
//
// Web: renders only the page row (logo/avatar already live in the Sidebar).
//
// Props:
//   title        — string   page name ("Today", "Tasks", …)
//   subtitle     — string   date or description shown below title
//   badgeCount   — number?  optional orange pill beside title
//   rightActions — node?    optional buttons (Sync / Brief Me) on Today tab

import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { T } from './Theme';
import { useBreakpoint } from '../hooks/useBreakpoint';

// ─── DotGridT — 3×3 dot grid that forms a "T" lettermark ─────────────────────
// Identical to the web Sidebar's logo mark.

const DotGridT = () => (
  <View style={s.dotGrid}>
    <View style={[s.dot, s.dotFilled]} />
    <View style={[s.dot, s.dotFilled]} />
    <View style={[s.dot, s.dotFilled]} />
    <View style={[s.dot, s.dotGhost]} />
    <View style={[s.dot, s.dotFilled]} />
    <View style={[s.dot, s.dotGhost]} />
    <View style={[s.dot, s.dotGhost]} />
    <View style={[s.dot, s.dotFilled]} />
    <View style={[s.dot, s.dotGhost]} />
  </View>
);

// ─── UserAvatar ───────────────────────────────────────────────────────────────

const UserAvatar = () => (
  <View style={s.avatar}>
    <Text style={s.avatarText}>RM</Text>
  </View>
);

// ─── AppRow — logo + wordmark + avatar ───────────────────────────────────────

const AppRow = () => (
  <View style={s.appRow}>
    <View style={s.brand}>
      <DotGridT />
      <Text style={s.wordmark}>
        Tasker<Text style={s.wordmarkAccent}>AI</Text>
      </Text>
    </View>
    <UserAvatar />
  </View>
);

// ─── PageRow — title + optional badge + subtitle + optional actions ───────────

const PageRow = ({ title, subtitle, badgeCount, rightActions }) => (
  <View style={s.pageRow}>
    <View style={s.pageMeta}>
      <View style={s.titleLine}>
        <Text style={s.title}>{title}</Text>
        {badgeCount != null && (
          <View style={s.badge}>
            <Text style={s.badgeText}>{badgeCount}</Text>
          </View>
        )}
      </View>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
    </View>
    {rightActions ? <View style={s.actions}>{rightActions}</View> : null}
  </View>
);

// ─── UnifiedPageHeader ───────────────────────────────────────────────────────

export const UnifiedPageHeader = ({ title, subtitle, badgeCount, rightActions }) => {
  const { isMobile } = useBreakpoint();

  // Web: sidebar already owns branding — render only the page context row.
  if (!isMobile) {
    return (
      <View style={s.webHeader}>
        <PageRow
          title={title}
          subtitle={subtitle}
          badgeCount={badgeCount}
          rightActions={rightActions}
        />
      </View>
    );
  }

  // Mobile: unified card — branding + divider + page context.
  return (
    <View style={s.card}>
      <AppRow />
      <View style={s.divider} />
      <PageRow
        title={title}
        subtitle={subtitle}
        badgeCount={badgeCount}
        rightActions={rightActions}
      />
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // ── Mobile wrapper — flush with screen, no card box ──
  card: {
    backgroundColor: T.bg,
  },

  // ── App row (mobile only) ──
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.sp5,
    paddingTop: T.sp3,
    paddingBottom: T.sp3,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.sp3,
  },
  dotGrid: {
    width: 24,
    height: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotFilled: {
    backgroundColor: T.fg,
  },
  dotGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: T.fg,
    opacity: 0.35,
  },
  wordmark: {
    fontFamily: Platform.OS === 'web' ? '"Plus Jakarta Sans", sans-serif' : undefined,
    fontSize: T.textBase,
    fontWeight: '700',
    color: T.fg,
    letterSpacing: -0.4,
  },
  wordmarkAccent: {
    color: T.accent,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: T.radiusPill,
    backgroundColor: T.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: T.textXs,
    fontWeight: '700',
    color: T.accent,
  },

  // ── Divider (mobile only) ──
  divider: {
    height: 1,
    backgroundColor: T.border,
  },

  // ── Page row (shared) ──
  pageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: T.sp5,
    paddingTop: T.sp3,
    paddingBottom: T.sp5,
    borderBottomWidth: 1,
    borderBottomColor: T.sidebarBorder,
  },
  pageMeta: {
    flex: 1,
    marginRight: T.sp3,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.sp2,
    marginBottom: 4,
  },
  title: {
    fontSize: T.textXl,
    fontWeight: '700',
    color: T.fg,
    letterSpacing: -0.5,
  },
  badge: {
    backgroundColor: T.accent,
    borderRadius: T.radiusPill,
    paddingHorizontal: T.sp2,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: T.textXs,
    fontWeight: '700',
    color: 'white',
  },
  subtitle: {
    fontSize: T.textSm,
    fontWeight: '400',
    color: T.muted,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.sp2,
    marginTop: 2,
  },

  // ── Web-only header ──
  webHeader: {
    borderBottomWidth: 1,
    borderBottomColor: T.sidebarBorder,
  },
});
