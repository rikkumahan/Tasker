// ─────────────────────────────────────────────────────────────────────────────
// Sidebar — Web-only navigation sidebar with glass effect
// Single responsibility: render nav items from NAV_ITEMS + brand + user zone
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { T } from '../Theme';
import { NAV_ITEMS } from '../../constants/navItems';
import useAuthStore from '../../store/authStore';
import useAppStore from '../../store/appStore';
import { supabase } from '../../lib/supabase';
import { IconSync, IconSettings, IconLogOut, IconDelete } from '../ProfileSheet';

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
const NavItem = ({ item, isActive, badgeOverride }) => {
  const router = useRouter();
  const [hovered, setHovered] = React.useState(false);

  const handlePress = useCallback(() => {
    router.push(item.href);
  }, [item.href, router]);

  const displayBadge = badgeOverride !== undefined ? badgeOverride : item.badge;

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
      {displayBadge != null && displayBadge > 0 && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{displayBadge}</Text>
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
  const fetchAll = useAppStore((s) => s.fetchAll);

  const [showProfile, setShowProfile] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const waitingCount = useAppStore(s =>
    s.threads.filter(t => t.action_type === 'reply' && !t.is_read).length
  );

  const isActive = useCallback((item) => {
    if (item.name === 'index') return pathname === '/' || pathname === '';
    return pathname.startsWith('/' + item.name);
  }, [pathname]);

  const userEmail = session?.user?.email || 'me@taskerai.app';
  const fullName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')?.[0] || 'User';
  const initials = fullName
    ? fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : (userEmail?.[0] || '?').toUpperCase();

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await supabase.functions.invoke('sync');
      await fetchAll(true);
      alert('Sync completed successfully.');
    } catch (e) {
      console.error('[Sidebar Web] sync error:', e);
      alert('Failed to start sync. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteAccount = async () => {
    const performDelete = async () => {
      setDeleting(true);
      try {
        await supabase.functions.invoke('delete-account');
        await signOut();
        setShowProfile(false);
      } catch (e) {
        console.error('[Sidebar Web] delete-account error:', e);
        alert('Failed to delete account. Please try again.');
      } finally {
        setDeleting(false);
      }
    };

    if (window.confirm('WARNING: Are you sure you want to permanently delete your account and all data? This cannot be undone.')) {
      performDelete();
    }
  };

  return (
    <View style={s.sidebar}>
      {/* Click outside backdrop */}
      {showProfile && (
        <Pressable
          style={s.popoverBackdrop}
          onPress={() => setShowProfile(false)}
        />
      )}

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
          <NavItem
            key={item.name}
            item={item}
            isActive={isActive(item)}
            badgeOverride={item.name === 'waiting' ? waitingCount : undefined}
          />
        ))}
      </View>

      {/* ── Floating Popover Profile Card ── */}
      {showProfile && (
        <View style={s.popoverCard}>
          <View style={s.popoverHeader}>
            <View style={s.popoverAvatar}>
              <Text style={s.popoverAvatarText}>{initials}</Text>
            </View>
            <View style={s.popoverText}>
              <Text style={s.popoverName} numberOfLines={1}>{fullName}</Text>
              <Text style={s.popoverEmail} numberOfLines={1}>{userEmail}</Text>
            </View>
          </View>

          <View style={s.popoverDivider} />

          <Pressable
            onPress={handleSync}
            disabled={syncing}
            style={({ pressed }) => [s.popoverRow, pressed && { opacity: 0.7 }]}
          >
            <IconSync />
            <Text style={s.popoverRowText}>{syncing ? 'Syncing...' : 'Force Sync'}</Text>
            {syncing && <ActivityIndicator size="small" color={T.accent} style={{ marginLeft: 'auto' }} />}
          </Pressable>

          <View style={s.popoverDivider} />

          <Pressable
            onPress={() => alert('Settings features are coming soon.')}
            style={({ pressed }) => [s.popoverRow, pressed && { opacity: 0.7 }]}
          >
            <IconSettings />
            <Text style={s.popoverRowText}>Settings</Text>
            <Text style={s.stubBadge}>Soon</Text>
          </Pressable>

          <View style={s.popoverDivider} />

          <Pressable
            onPress={() => { setShowProfile(false); signOut(); }}
            style={({ pressed }) => [s.popoverRow, pressed && { opacity: 0.7 }]}
          >
            <IconLogOut />
            <Text style={s.popoverRowText}>Sign Out</Text>
          </Pressable>

          <View style={s.popoverDivider} />

          <Pressable
            onPress={handleDeleteAccount}
            disabled={deleting}
            style={({ pressed }) => [s.popoverRow, pressed && { opacity: 0.7 }]}
          >
            <IconDelete />
            <Text style={[s.popoverRowText, { color: T.danger }]}>Delete Account</Text>
            {deleting && <ActivityIndicator size="small" color={T.danger} style={{ marginLeft: 'auto' }} />}
          </Pressable>
        </View>
      )}

      {/* ── Bottom User Zone (Clickable to open Popover) ── */}
      <Pressable
        onPress={() => setShowProfile(prev => !prev)}
        style={({ pressed }) => [s.userZone, pressed && { opacity: 0.7 }]}
      >
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initials}</Text>
        </View>
        <View style={s.userInfo}>
          <Text style={s.userName} numberOfLines={1} ellipsizeMode="tail">{fullName}</Text>
          <Text style={s.userEmail} numberOfLines={1} ellipsizeMode="tail">View Profile ({userEmail})</Text>
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

  // ── Web Profile Dropdown ──
  popoverBackdrop: {
    position: Platform.OS === 'web' ? 'fixed' : 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 99,
    backgroundColor: 'transparent',
  },
  popoverCard: {
    position: 'absolute',
    bottom: 84,
    left: 16,
    right: 16,
    backgroundColor: T.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.border,
    padding: 12,
    zIndex: 100,
    ...Platform.select({
      web: {
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        backdropFilter: 'blur(16px)',
      },
      default: {
        elevation: 8,
      }
    }),
  },
  popoverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  popoverAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.accentTint || 'rgba(242,103,60,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popoverAvatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: T.accent,
  },
  popoverText: {
    flex: 1,
    minWidth: 0,
  },
  popoverName: {
    fontSize: 14,
    fontWeight: '600',
    color: T.fg,
  },
  popoverEmail: {
    fontSize: 11,
    color: T.muted,
  },
  popoverDivider: {
    height: 1,
    backgroundColor: T.borderSoft,
    marginVertical: 4,
  },
  popoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  popoverRowText: {
    fontSize: 13,
    fontWeight: '500',
    color: T.fg2,
    marginLeft: 8,
  },
  stubBadge: {
    marginLeft: 'auto',
    fontSize: 10,
    fontWeight: '600',
    color: T.muted,
    backgroundColor: T.borderSoft,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
});
