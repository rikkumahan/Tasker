import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  Animated, Dimensions, ScrollView, Pressable, Platform,
} from 'react-native';
import { T, PRIORITY_PANEL_META } from './Theme';
import { GmailIcon, IconClose, IconExternalLink, IconCopy, IconCheck } from './Icons';
import { useBreakpoint } from '../hooks/useBreakpoint';

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_H = SCREEN_H * 0.85;

// ─── Primitives ───────────────────────────────────────────────────────────────

const SectionLabel = ({ children }) => (
  <Text style={s.sectionLabel}>{children}</Text>
);

// ─── Shared Panel Content (used in both mobile sheet + web drawer + task detail panel) ────────────

export const PanelContent = ({ item, onClose }) => {
  const [actionDone, setActionDone] = useState(false);
  const [copied, setCopied]         = useState(false);

  useEffect(() => {
    setActionDone(false);
    setCopied(false);
  }, [item?.id]);

  const handleCopy = useCallback(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const pm = PRIORITY_PANEL_META[item?.priority] ?? PRIORITY_PANEL_META.medium;

  if (!item) return null;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={s.scrollContent}
    >
      {/* ── Email-style header ── */}
      <View style={s.headerOuter}>
        <View style={s.headerRow}>
          <GmailIcon size={20} />
          <Text style={s.subject} numberOfLines={2}>{item.subject}</Text>
          <View style={[s.priorityBadge, { backgroundColor: pm.bg, borderColor: pm.border }]}>
            <Text style={[s.priorityBadgeText, { color: pm.fg }]}>{pm.label}</Text>
          </View>
          <TouchableOpacity style={s.iconBtn} onPress={onClose}>
            <IconClose size={13} color="#9CA3AF" />
          </TouchableOpacity>
        </View>
        <View style={s.senderRow}>
          <Text style={s.senderName}>{item.assignedFrom}</Text>
          <Text style={s.senderMeta}> · {item.senderEmail} · {item.timeAgo} ago</Text>
        </View>
      </View>

      {/* ── AI Summary ── */}
      <View style={s.section}>
        <SectionLabel>AI Summary</SectionLabel>
        <View style={s.summaryCard}>
          <Text style={s.summaryText}>{item.aiSummary}</Text>
        </View>
      </View>

      {/* ── Suggested Action ── */}
      <View style={s.section}>
        <SectionLabel>Suggested Action</SectionLabel>
        <TouchableOpacity
          onPress={() => setActionDone(!actionDone)}
          activeOpacity={0.8}
          style={[
            s.actionCard,
            actionDone
              ? { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }
              : { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
          ]}
        >
          <View style={[s.checkbox, actionDone && s.checkboxDone]}>
            {actionDone && <IconCheck size={10} color="white" />}
          </View>
          <Text style={[
            s.actionText,
            { color: actionDone ? '#15803D' : '#92400E' },
            actionDone && { textDecorationLine: 'line-through' },
          ]}>
            {item.action}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Important Context ── */}
      <View style={s.section}>
        <SectionLabel>Important Context</SectionLabel>
        <View style={s.contextCard}>
          <Text style={s.contextText}>{item.aiContext}</Text>
        </View>
      </View>

      {/* ── Related People ── */}
      <View style={s.section}>
        <SectionLabel>Related People</SectionLabel>
        <View style={s.chipsRow}>
          {item.relatedPeople.map(p => (
            <View key={p} style={s.chip}>
              <Text style={s.chipText}>{p}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Suggested Reply ── */}
      <View style={s.section}>
        <View style={s.replyHeaderRow}>
          <SectionLabel>Suggested Reply</SectionLabel>
          <TouchableOpacity
            onPress={handleCopy}
            activeOpacity={0.85}
            style={[s.useReplyBtn, copied && { backgroundColor: T.success }]}
          >
            {!copied && <IconCopy size={13} color="white" />}
            <Text style={s.useReplyText}>{copied ? '✓ Copied!' : 'Use Reply'}</Text>
          </TouchableOpacity>
        </View>
        <View style={s.replyCard}>
          <Text style={s.replyText}>{item.suggestedReply}</Text>
        </View>
      </View>
    </ScrollView>
  );
};

// ─── Web Right Drawer ─────────────────────────────────────────────────────────
// Slides in from right, 380px wide, glass-border left edge
// Motion: 240ms cubic-bezier(0.2,0,0,1) — from DESIGN_SYSTEM.md

const WebDrawer = ({ visible, item, onClose }) => {
  const slideAnim   = useRef(new Animated.Value(T.drawerW)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: T.motionBase,   // 240ms
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: T.motionBase,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: T.drawerW,
          duration: T.motionBase,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: T.motionFast,   // 150ms — faster on close
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!visible && !item) return null;

  return (
    <>
      {/* Dim backdrop behind drawer */}
      <Animated.View
        style={[s.webBackdrop, { opacity: backdropAnim }]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Right-side drawer */}
      <Animated.View
        style={[s.webDrawer, { transform: [{ translateX: slideAnim }] }]}
      >
        <PanelContent item={item} onClose={onClose} />
      </Animated.View>
    </>
  );
};

// ─── Mobile Bottom Sheet ──────────────────────────────────────────────────────
// Unchanged from original implementation

const MobileSheet = ({ visible, item, onClose }) => {
  const slideAnim   = useRef(new Animated.Value(SHEET_H)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          damping: 20,
          stiffness: 200,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SHEET_H,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Dimmed backdrop */}
      <Animated.View
        style={[s.backdrop, { opacity: backdropAnim }]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}
      >
        <View style={s.handleRow}>
          <View style={s.handle} />
        </View>
        <PanelContent item={item} onClose={onClose} />
      </Animated.View>
    </Modal>
  );
};

// ─── AIPanel — Platform router ────────────────────────────────────────────────
// Chooses web drawer OR mobile sheet based on breakpoint

const AIPanel = ({ visible, item, onClose }) => {
  const { isDesktop } = useBreakpoint();

  if (isDesktop) {
    return <WebDrawer visible={visible} item={item} onClose={onClose} />;
  }
  return <MobileSheet visible={visible} item={item} onClose={onClose} />;
};

// No-op provider since we no longer need BottomSheetModalProvider
export const AIPanelProvider = ({ children }) => <>{children}</>;

export default AIPanel;

// ─────────────────────────────────────────────────────────────────────────────
// STYLES — All values from DESIGN_SYSTEM.md / Theme.js
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // ── Mobile backdrop / sheet ──
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.50)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: SHEET_H,
    backgroundColor: T.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 20 },
      android: { elevation: 20 },
    }),
  },
  handleRow: { alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: T.border },

  // ── Web right drawer ──
  webBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.30)',  // lighter than mobile per design spec
    zIndex: 99,
    ...Platform.select({
      web: { position: 'fixed' },
    }),
  },
  webDrawer: {
    top: 0, right: 0, bottom: 0,
    width: T.drawerW,              // 380px — from DESIGN_SYSTEM.md
    backgroundColor: T.surface,   // #ffffff
    borderLeftWidth: 1,
    borderLeftColor: T.sidebarBorder,  // rgba(230,180,150,0.28)
    zIndex: 100,
    ...Platform.select({
      web: {
        position: 'fixed',
        boxShadow: '-8px 0 32px rgba(242,103,60,0.08)',  // warm shadow from design spec
      },
      default: {
        position: 'absolute',
      }
    }),
  },

  // ── Shared content ──
  scrollContent: { paddingBottom: 40 },

  headerOuter: {
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 13,
    borderBottomWidth: 1, borderBottomColor: T.border,
    backgroundColor: '#FAFAFA',
  },
  headerRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  subject: {
    flex: 1, fontSize: 13, fontWeight: '700', color: T.fg,
    lineHeight: 18, minWidth: 0,
  },
  priorityBadge: {
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 5, borderWidth: 1, flexShrink: 0,
  },
  priorityBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  iconBtn:    { padding: 4, flexShrink: 0 },
  senderRow:  { flexDirection: 'row', flexWrap: 'wrap', marginTop: 7, marginLeft: 29 },
  senderName: { fontSize: 12, fontWeight: '600', color: T.fg2 },
  senderMeta: { fontSize: 12, color: T.muted },

  section:      { paddingHorizontal: T.sp5, paddingTop: T.sp5 },
  sectionLabel: { fontSize: T.textXs, fontWeight: '600', color: T.fg2, letterSpacing: 0.1, marginBottom: 8 },

  summaryCard: {
    backgroundColor: T.warmSurface, borderWidth: 1, borderColor: T.warmBorder,
    borderRadius: T.radiusSm, padding: 14,
  },
  summaryText: { fontSize: 13, color: T.fg2, lineHeight: 21 },

  actionCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11,
    borderWidth: 1, borderRadius: T.radiusSm, padding: 14,
  },
  checkbox: {
    width: 18, height: 18, borderRadius: 4, borderWidth: 2,
    borderColor: '#D1D5DB', backgroundColor: 'white',
    alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0,
  },
  checkboxDone: { backgroundColor: T.success, borderColor: T.success },
  actionText:   { fontSize: 13, lineHeight: 20, flex: 1 },

  contextCard: {
    borderLeftWidth: 3, borderLeftColor: T.accent,   // #F2673C
    backgroundColor: T.warmSurface,
    borderTopRightRadius: 8, borderBottomRightRadius: 8,
    padding: 14,
  },
  contextText: { fontSize: 13, color: T.fg2, lineHeight: 21 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: T.surfaceNeutral, borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusPill, paddingHorizontal: 12, paddingVertical: 5,
  },
  chipText: { fontSize: 12, fontWeight: '500', color: T.fg2 },

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
    borderRadius: T.radiusSm, padding: 14,
  },
  replyText: { fontSize: 13, color: T.fg2, lineHeight: 21 },
});
