// ProfileSheet.js — Design system compliant bottom sheet modal for profile settings.
// Uses T design tokens from Theme.js for brand alignment.

import React, { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, Pressable, Platform, Alert, ActivityIndicator
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { T } from './Theme';
import useAuthStore from '../store/authStore';
import useAppStore from '../store/appStore';
import { supabase } from '../lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// SVG Icons
export const IconSync = ({ color = T.fg2 }) => (
  <View style={s.iconWrap}>
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M21.5 2v6h-6M21.34 15.57a10 10 0 10-.57 8.38l.73-.73" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  </View>
);

export const IconSettings = ({ color = T.fg2 }) => (
  <View style={s.iconWrap}>
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="2" />
      <Path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  </View>
);

export const IconLogOut = ({ color = T.fg2 }) => (
  <View style={s.iconWrap}>
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  </View>
);

export const IconDelete = ({ color = T.danger }) => (
  <View style={s.iconWrap}>
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  </View>
);

export default function ProfileSheet({ visible, onClose }) {
  const session = useAuthStore(s => s.session);
  const signOut = useAuthStore(s => s.signOut);
  const userSettings = useAppStore(s => s.userSettings);
  const fetchAll = useAppStore(s => s.fetchAll);

  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const insets = useSafeAreaInsets();

  if (!session) return null;

  // Extract User Info
  const fullName = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User';
  const gmailEmail = userSettings?.gmail_email || session.user.email || '';
  
  // Format initials
  const initials = (() => {
    const parts = fullName.replace(/['"]/g, '').trim().split(/\s+/);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  })();

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await supabase.functions.invoke('sync');
      await fetchAll(true);
      if (Platform.OS === 'web') {
        alert('Sync completed successfully.');
      } else {
        Alert.alert('Sync Successful', 'Your inbox is now up to date.');
      }
    } catch (e) {
      console.error('[ProfileSheet] sync error:', e);
      if (Platform.OS === 'web') {
        alert('Failed to start sync. Please try again.');
      } else {
        Alert.alert('Sync Failed', 'Failed to start sync. Please try again.');
      }
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
        onClose();
      } catch (e) {
        console.error('[ProfileSheet] delete-account error:', e);
        if (Platform.OS === 'web') {
          alert('Failed to delete account. Please contact support.');
        } else {
          Alert.alert('Error', 'Failed to delete account. Please try again.');
        }
      } finally {
        setDeleting(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('WARNING: Are you sure you want to permanently delete your account and all data? This cannot be undone.')) {
        performDelete();
      }
    } else {
      Alert.alert(
        'Delete Account',
        'Are you sure you want to permanently delete your account and all data? This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: performDelete },
        ]
      );
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable
          style={[s.sheet, { paddingBottom: Math.max(insets.bottom, T.sp6) + 12 }]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header row: profile identity */}
          <View style={s.profileHeader}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
            <View style={s.profileText}>
              <Text style={s.name}>{fullName}</Text>
              <Text style={s.email} numberOfLines={1}>{gmailEmail}</Text>
            </View>
          </View>

          <View style={s.divider} />

          {/* Sync item */}
          <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={handleSync} disabled={syncing}>
            <IconSync />
            <Text style={s.rowText}>{syncing ? 'Syncing...' : 'Force Sync'}</Text>
            {syncing && <ActivityIndicator size="small" color={T.accent} style={{ marginLeft: 'auto' }} />}
          </TouchableOpacity>

          <View style={s.divider} />

          {/* Settings item (stub) */}
          <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => Alert.alert('Settings', 'Settings features are coming soon.')}>
            <IconSettings />
            <Text style={s.rowText}>Settings</Text>
            <Text style={s.stubBadge}>Soon</Text>
          </TouchableOpacity>

          <View style={s.divider} />

          {/* Sign Out item */}
          <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => { signOut(); onClose(); }}>
            <IconLogOut />
            <Text style={s.rowText}>Sign Out</Text>
          </TouchableOpacity>

          <View style={s.divider} />

          {/* Delete Account item */}
          <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={handleDeleteAccount} disabled={deleting}>
            <IconDelete />
            <Text style={[s.rowText, { color: T.danger }]}>Delete Account</Text>
            {deleting && <ActivityIndicator size="small" color={T.danger} style={{ marginLeft: 'auto' }} />}
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.surface,
    borderTopLeftRadius: T.radiusMd,
    borderTopRightRadius: T.radiusMd,
    paddingHorizontal: T.sp6,
    paddingTop: T.sp6,
    ...Platform.select({
      ios: { shadowColor: 'black', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 16 },
      android: { elevation: 20 },
    }),
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: T.sp5,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: T.sp4,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: T.accent,
  },
  profileText: {
    flex: 1,
    justifyContent: 'center',
  },
  name: {
    fontFamily: Platform.OS === 'web' ? '"Plus Jakarta Sans", sans-serif' : undefined,
    fontSize: 16,
    fontWeight: '700',
    color: T.fg,
    marginBottom: 2,
  },
  email: {
    fontSize: T.textSm,
    color: T.muted,
  },
  divider: {
    height: 1,
    backgroundColor: T.borderSoft,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
  },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: T.sp4,
  },
  rowText: {
    fontSize: T.textSm,
    fontWeight: '500',
    color: T.fg2,
  },
  stubBadge: {
    marginLeft: 'auto',
    fontSize: 10,
    fontWeight: '600',
    color: T.muted,
    backgroundColor: T.borderSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
