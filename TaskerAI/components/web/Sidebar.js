// ─────────────────────────────────────────────────────────────────────────────
// Sidebar — Web-only navigation sidebar with glass effect
// Single responsibility: render nav items from NAV_ITEMS + brand + user zone
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { T } from '../Theme';
import { NAV_ITEMS } from '../../constants/navItems';
import useAuthStore from '../../store/authStore';

// ── Logo Mark — Dot Grid T (SVG via inline approach for web) ─────────────────
const DotGridT = () => (
  <View style={s.markGrid}>
    {/* Row 1: filled, filled, filled */}
    <View style={[s.dot, s.dotFilled]} />
    <View style={[s.dot, s.dotFilled]} />
    <View style={[s.dot, s.dotFilled]} />
    {/* Row 2: ghost, filled (center), ghost */}
    <View style={[s.dot, s.dotGhost]} />
    <View style={[s.dot, s.dotFilled]} />
    <View style={[s.dot, s.dotGhost]} />
    {/* Row 3: ghost, filled (stem), ghost */}
    <View style={[s.dot, s.dotGhost]} />
    <View style={[s.dot, s.dotFilled]} />
    <View style={[s.dot, s.dotGhost]} />
  </View>
);

// ── Single Nav Item ───────────────────────────────────────────────────────────
const NavItem = ({ item, isActive }) => {
  const router = useRouter();
  const [hovered, setHovered] = React.useState(false);

  const handlePress = useCallback(() => {
    router.push(item.href);
  }, [item.href, router]);

  return (
    <Pressable
      onPress={handlePress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        s.navItem,
        isActive && s.navItemActive,
        !isActive && hovered && s.navItemHovered,
      ]}
    >
      {/* Active left border indicator */}
      <View style={[s.activeBorder, isActive && s.activeBorderOn]} />

      {/* Icon */}
      <item.Icon
        size={18}
        color={isActive ? T.accent : (hovered ? T.fg2 : T.muted)}
      />

      {/* Label */}
      <Text style={[s.navLabel, isActive && s.navLabelActive]}>
        {item.label}
      </Text>

      {/* Badge */}
      {item.badge != null && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{item.badge}</Text>
        </View>
      )}
    </Pressable>
  );
};

// ── Sidebar ───────────────────────────────────────────────────────────────────
export default function Sidebar() {
  const pathname = usePathname();
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);

  const isActive = useCallback((item) => {
    if (item.name === 'index') return pathname === '/' || pathname === '';
    return pathname.startsWith('/' + item.name);
  }, [pathname]);

  const userEmail = session?.user?.email || 'me@taskerai.app';
  const fullName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')?.[0] || 'User';
  const initials = fullName
    ? fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : (userEmail?.[0] || '?').toUpperCase();

  return (
    <View style={s.sidebar}>
      {/* ── Logo Zone ── */}
      <View style={s.logoZone}>
        <DotGridT />
        <Text style={s.wordmark}>
          Tasker<Text style={s.wordmarkAI}>AI</Text>
        </Text>
      </View>

      {/* ── Nav Section Label ── */}
      <Text style={s.sectionLabel}>WORKSPACE</Text>

      {/* ── Nav Items ── */}
      <View style={s.navList}>
        {NAV_ITEMS.map(item => (
          <NavItem key={item.name} item={item} isActive={isActive(item)} />
        ))}
      </View>

      {/* ── Bottom User Zone (Clickable to Sign Out) ── */}
      <Pressable
        onPress={signOut}
        style={({ pressed }) => [s.userZone, pressed && { opacity: 0.7 }]}
      >
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initials}</Text>
        </View>
        <View style={s.userInfo}>
          <Text style={s.userName}>{fullName}</Text>
          <Text style={s.userEmail}>Sign Out ({userEmail})</Text>
        </View>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES — All values sourced from DESIGN_SYSTEM.md / Theme.js
// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  sidebar: {
    width: T.sidebarW,
    height: '100%',
    backgroundColor: T.sidebarBg,
    borderRightWidth: 1,
    borderRightColor: T.sidebarBorder,
    flexShrink: 0,
    ...Platform.select({
      web: { backdropFilter: 'blur(20px)', position: 'sticky', top: 0 },
    }),
  },

  // ── Logo Zone ──
  logoZone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.sp3,
    paddingHorizontal: T.sp6,
    paddingTop: T.sp6,
    paddingBottom: T.sp5,
    borderBottomWidth: 1,
    borderBottomColor: T.sidebarBorder,
  },
  markGrid: {
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
  wordmarkAI: {
    color: T.accent,  // #F2673C
  },

  // ── Section Label ──
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: T.muted,
    letterSpacing: 0.8,
    paddingHorizontal: T.sp6,
    paddingTop: T.sp5,
    paddingBottom: T.sp2,
  },

  // ── Nav List ──
  navList: {
    flex: 1,
    paddingHorizontal: T.sp3,
    gap: 2,
  },

  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.sp3,
    paddingVertical: T.sp3,
    paddingLeft: T.sp3,
    paddingRight: T.sp4,
    borderRadius: T.radiusSm,
    position: 'relative',
    overflow: 'hidden',
    // Smooth hover/active transitions
    ...Platform.select({
      web: { transition: `background-color ${T.motionFast}ms ${T.ease}, color ${T.motionFast}ms ${T.ease}` },
    }),
  },
  navItemActive: {
    backgroundColor: '#F1F5F9',  // T.surfaceWarm
  },
  navItemHovered: {
    backgroundColor: '#F9FAFB',  // T.surfaceNeutral
  },

  // Left 3px orange border for active item
  activeBorder: {
    position: 'absolute',
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  activeBorderOn: {
    backgroundColor: T.accent,  // #F2673C
  },

  navLabel: {
    flex: 1,
    fontSize: T.textSm,        // 14px
    fontWeight: '400',
    color: T.fg2,              // #374151 inactive
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  navLabelActive: {
    fontWeight: '700',
    color: T.accent,           // #F2673C active
  },

  badge: {
    backgroundColor: T.accent,
    borderRadius: T.radiusPill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: 'white',
  },

  // ── User Zone ──
  userZone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.sp3,
    padding: T.sp5,
    paddingHorizontal: T.sp6,
    borderTopWidth: 1,
    borderTopColor: T.sidebarBorder,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: 'white',
  },
  userInfo: { flex: 1 },
  userName: {
    fontSize: T.textSm,
    fontWeight: '600',
    color: T.fg,
  },
  userEmail: {
    fontSize: T.textXs,
    color: T.muted,
    marginTop: 1,
  },
});
