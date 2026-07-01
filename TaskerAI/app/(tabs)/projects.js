import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Text } from 'react-native';
import { T } from '../../components/Theme';
import { UnifiedPageHeader } from '../../components/UnifiedPageHeader';
import useAppStore from '../../store/appStore';
import { useTabBarPadding } from '../../hooks/useTabBarPadding';
import { IconSparkle } from '../../components/Icons';

const ProjectCard = ({ project }) => {
  const statusColor = project.status === 'active' ? T.success : T.muted;
  return (
    <View style={s.projectCard}>
      <View style={s.projectHeader}>
        <Text style={s.projectName}>{project.name}</Text>
        <View style={[s.statusBadge, { borderColor: statusColor }]}>
          <Text style={[s.statusText, { color: statusColor }]}>
            {(project.status || 'active').toUpperCase()}
          </Text>
        </View>
      </View>
      <Text style={s.projectDesc} numberOfLines={2}>
        {project.description || 'No description provided.'}
      </Text>
    </View>
  );
};

const EmptyState = () => (
  <View style={es.wrap}>
    <View style={es.iconWrap}>
      <IconSparkle size={28} color={T.muted} />
    </View>
    <Text style={es.heading}>No projects yet</Text>
    <Text style={es.sub}>Active projects will appear here.</Text>
  </View>
);

const es = StyleSheet.create({
  wrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  iconWrap:{ opacity: 0.35, marginBottom: T.sp4 },
  heading: { fontSize: T.textSm, fontWeight: '600', color: T.fg2, marginBottom: 4 },
  sub:     { fontSize: T.textSm, fontWeight: '400', color: T.muted },
});

export default function ProjectsScreen() {
  const tabBarPadding = useTabBarPadding();
  const { projects, loading, refreshing, fetchAll } = useAppStore();

  const handleRefresh = useCallback(() => {
    fetchAll(true);
  }, [fetchAll]);

  if (loading && projects.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.bg }}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <UnifiedPageHeader
        title="Projects"
        subtitle="Your active context tracks"
        badgeCount={projects.length}
      />
      <View style={s.listWrap}>
        <FlatList
          data={projects}
          keyExtractor={p => p.id}
          renderItem={({ item }) => <ProjectCard project={item} />}
          ListEmptyComponent={<EmptyState />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={
            projects.length === 0
              ? { flex: 1 }
              : { paddingBottom: tabBarPadding, paddingTop: T.sp4 }
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[T.accent]}
              tintColor={T.accent}
            />
          }
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  listWrap: { flex: 1, paddingHorizontal: T.sp6 },
  projectCard: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: 'rgba(230,180,150,0.38)',
    borderRadius: T.radiusSm,
    padding: T.sp4,
    marginBottom: T.sp3,
    shadowColor: 'rgba(200,120,80,0.06)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 2,
  },
  projectHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  projectName: {
    fontSize: T.textBase,
    fontWeight: '700',
    color: T.fg,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  projectDesc: {
    fontSize: T.textSm,
    color: T.muted,
    lineHeight: T.textSm * 1.45,
  },
});
