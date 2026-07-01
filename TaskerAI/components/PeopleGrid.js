// PeopleGrid — Search bar + responsive card grid with tappable cards.
// Tapping a card opens a centered PersonDetailModal.

import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  FlatList, Modal, Pressable, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { T } from './Theme';
import { PEOPLE } from './mockData';
import { useBreakpoint } from '../hooks/useBreakpoint';

// ─── PeopleSearchBar ──────────────────────────────────────────────────────────

const PeopleSearchBar = ({ value, onChangeText, onClear }) => (
  <View style={sb.wrapper}>
    <Text style={sb.icon}>⌕</Text>
    <TextInput
      style={sb.input}
      placeholder="Search by name, email, or organisation…"
      placeholderTextColor={T.muted}
      value={value}
      onChangeText={onChangeText}
      returnKeyType="search"
      autoCorrect={false}
      autoCapitalize="none"
    />
    {value.length > 0 && (
      <TouchableOpacity onPress={onClear} style={sb.clearBtn} activeOpacity={0.7}>
        <Text style={sb.clearText}>×</Text>
      </TouchableOpacity>
    )}
  </View>
);

const sb = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radiusSm,
    paddingHorizontal: T.sp4,
    paddingVertical: T.sp3,
    marginBottom: T.sp4,
  },
  icon:      { fontSize: T.textSm, color: T.muted, marginRight: T.sp2 },
  input: {
    flex: 1,
    fontSize: T.textSm,
    fontWeight: '500',
    color: T.fg,
    padding: 0,
  },
  clearBtn:  { marginLeft: T.sp2, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: T.textLg, color: T.muted, lineHeight: 20 },
});

// ─── AvatarInitials ───────────────────────────────────────────────────────────

const AvatarInitials = ({ initials, size = 48 }) => (
  <View style={[av.circle, { width: size, height: size }]}>
    <Text style={[av.text, size > 48 && { fontSize: T.textXl }]}>{initials}</Text>
  </View>
);

const av = StyleSheet.create({
  circle: {
    borderRadius: T.radiusPill,
    backgroundColor: T.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: T.textBase,
    fontWeight: '700',
    color: T.accent,
  },
});

// ─── PersonCard ───────────────────────────────────────────────────────────────

const PersonCard = ({ person, isMobile, onPress }) => (
  <TouchableOpacity
    style={[pc.card, isMobile && pc.cardMobile]}
    onPress={() => onPress(person)}
    activeOpacity={0.75}
  >
    <AvatarInitials initials={person.initials} size={isMobile ? 36 : 48} />
    <View style={isMobile ? pc.contentMobile : null}>
      <Text style={[pc.name, isMobile && pc.nameMobile]} numberOfLines={1}>{person.name}</Text>
      <Text style={pc.email} numberOfLines={1}>{person.email}</Text>
      {!isMobile && (
        <Text style={pc.snippet} numberOfLines={3}>{person.snippet}</Text>
      )}
    </View>
  </TouchableOpacity>
);

const pc = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: T.surface,
    borderRadius: T.radiusMd,
    borderWidth: 1,
    borderColor: T.border,
    padding: T.sp4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  cardMobile: {
    padding: T.sp3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.sp3,
    elevation: 1,
  },
  contentMobile: {
    flex: 1,
  },
  name: {
    fontSize: T.textBase,
    fontWeight: '700',
    color: T.fg,
    marginBottom: T.sp1,
    marginTop: T.sp3,
  },
  nameMobile: {
    fontSize: T.textSm,
    marginTop: 0,
    marginBottom: 2,
  },
  email: {
    fontSize: T.textSm,
    fontWeight: '400',
    color: T.accent,
    marginBottom: T.sp2,
  },
  snippet: {
    fontSize: T.textSm,
    fontWeight: '400',
    color: T.muted,
    lineHeight: T.textSm * 1.5,
  },
});

// ─── PersonDetailModal ────────────────────────────────────────────────────────
// Centered modal window — works on both web and mobile.

const PersonDetailModal = ({ person, visible, onClose }) => {
  if (!person) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={md.backdrop} onPress={onClose}>
        <Pressable style={md.card} onPress={e => e.stopPropagation()}>
          {/* Close button */}
          <TouchableOpacity style={md.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={md.closeText}>✕</Text>
          </TouchableOpacity>

          {/* Avatar */}
          <View style={md.avatarWrap}>
            <AvatarInitials initials={person.initials} size={64} />
          </View>

          {/* Name */}
          <Text style={md.name}>{person.name}</Text>

          {/* Org badge */}
          <View style={md.orgBadge}>
            <Text style={md.orgText}>{person.org}</Text>
          </View>

          {/* Email */}
          <View style={md.row}>
            <Text style={md.label}>Email</Text>
            <Text style={md.value} numberOfLines={1}>{person.email}</Text>
          </View>

          {/* Divider */}
          <View style={md.divider} />

          {/* Context / Snippet */}
          <View style={md.contextSection}>
            <Text style={md.contextLabel}>Context</Text>
            <Text style={md.contextText}>{person.snippet}</Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const md = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: T.sp6,
  },
  card: {
    backgroundColor: T.surface,
    borderRadius: T.radiusMd,
    padding: T.sp6,
    width: '100%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  closeBtn: {
    position: 'absolute',
    top: T.sp4,
    right: T.sp4,
    width: 28,
    height: 28,
    borderRadius: T.radiusPill,
    backgroundColor: T.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  closeText: {
    fontSize: T.textSm,
    fontWeight: '600',
    color: T.muted,
    lineHeight: T.textSm,
  },
  avatarWrap: {
    alignItems: 'center',
    marginBottom: T.sp4,
  },
  name: {
    fontSize: T.textLg,
    fontWeight: '700',
    color: T.fg,
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: T.sp2,
  },
  orgBadge: {
    alignSelf: 'center',
    backgroundColor: T.accentTint,
    borderRadius: T.radiusPill,
    paddingHorizontal: T.sp3,
    paddingVertical: T.sp1,
    marginBottom: T.sp5,
  },
  orgText: {
    fontSize: T.textXs,
    fontWeight: '600',
    color: T.accent,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: T.sp3,
  },
  label: {
    fontSize: T.textSm,
    fontWeight: '500',
    color: T.muted,
  },
  value: {
    fontSize: T.textSm,
    fontWeight: '500',
    color: T.accent,
    flex: 1,
    textAlign: 'right',
    marginLeft: T.sp4,
  },
  divider: {
    height: 1,
    backgroundColor: T.border,
    marginVertical: T.sp4,
  },
  contextSection: {
    backgroundColor: T.warmSurface,
    borderRadius: T.radiusSm,
    padding: T.sp4,
    borderWidth: 1,
    borderColor: T.warmBorder,
  },
  contextLabel: {
    fontSize: T.textXs,
    fontWeight: '600',
    color: T.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: T.sp2,
  },
  contextText: {
    fontSize: T.textSm,
    fontWeight: '400',
    color: T.fg2,
    lineHeight: T.textSm * 1.55,
  },
});

// ─── PeopleEmptyState ─────────────────────────────────────────────────────────

const NO_RESULTS_HEADING = 'No people found';
const NO_RESULTS_SUB     = 'Try a different name, email, or organisation';
const EMPTY_HEADING      = 'No contacts yet';
const EMPTY_SUB          = 'Contacts will appear as threads are processed';

const PeopleEmptyState = ({ isSearch }) => (
  <View style={em.wrap}> 
    <Text style={em.icon}>👤</Text>
    <Text style={em.heading}>{isSearch ? NO_RESULTS_HEADING : EMPTY_HEADING}</Text>
    <Text style={em.sub}>{isSearch ? NO_RESULTS_SUB : EMPTY_SUB}</Text>
  </View>
);

const em = StyleSheet.create({
  wrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  icon:    { fontSize: 32, marginBottom: T.sp4 },
  heading: { fontSize: T.textSm, fontWeight: '600', color: T.fg2, marginBottom: T.sp1 },
  sub:     { fontSize: T.textSm, fontWeight: '400', color: T.muted, textAlign: 'center', paddingHorizontal: T.sp8 },
});

// ─── PeopleGrid ───────────────────────────────────────────────────────────────

const matchesPerson = (person, query) =>
  person.name.toLowerCase().includes(query)
  || person.email.toLowerCase().includes(query)
  || person.org.toLowerCase().includes(query);

const filterPeople = (people, rawQuery) => {
  const q = rawQuery.toLowerCase().trim();
  return q ? people.filter(p => matchesPerson(p, q)) : people;
};

export const PeopleGrid = ({
  numColumns, contentPaddingBottom = 0,
  data, loading, onRefresh, refreshing
}) => {
  const { isMobile } = useBreakpoint();
  const [search, setSearch] = useState('');
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  const sourceData = data || PEOPLE;

  const filtered = useMemo(
    () => filterPeople(sourceData, search),
    [sourceData, search],
  );

  const handleCardPress = useCallback((person) => {
    setSelectedPerson(person);
    setModalVisible(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setModalVisible(false);
  }, []);

  const listKey = `people-grid-${numColumns}`;

  const renderCard = ({ item }) => (
    <View style={pg.cardWrap}>
      <PersonCard person={item} isMobile={isMobile} onPress={handleCardPress} />
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 }}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  return (
    <View style={pg.root}>
      <PeopleSearchBar
        value={search}
        onChangeText={setSearch}
        onClear={() => setSearch('')}
      />
      <FlatList
        key={listKey}
        data={filtered}
        keyExtractor={p => p.id}
        numColumns={numColumns}
        renderItem={renderCard}
        ListEmptyComponent={<PeopleEmptyState isSearch={search.length > 0} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          filtered.length === 0
            ? { flex: 1 }
            : contentPaddingBottom > 0
              ? { paddingBottom: contentPaddingBottom }
              : null
        }
        columnWrapperStyle={numColumns > 1 ? pg.columnWrapper : null}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing || false}
              onRefresh={onRefresh}
              colors={[T.accent]}
              tintColor={T.accent}
            />
          ) : undefined
        }
      />
      <PersonDetailModal
        person={selectedPerson}
        visible={modalVisible}
        onClose={handleModalClose}
      />
    </View>
  );
};

const pg = StyleSheet.create({
  root:          { flex: 1 },
  columnWrapper: { gap: T.sp3 },
  cardWrap:      { flex: 1, marginBottom: T.sp3 },
});
