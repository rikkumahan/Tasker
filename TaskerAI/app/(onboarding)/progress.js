import { useRef, useEffect } from 'react';
import { View, Text, Animated, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { T } from '../../components/Theme';
import { BRAND } from '../../lib/brand';
import useAuthStore from '../../store/authStore';
import useOnboardingPolling from '../../hooks/useOnboardingPolling';

const STAGES = [
  { key: 'fetch', label: 'Fetching emails' },
  { key: 'filter', label: 'Filtering noise' },
  { key: 'graph', label: 'Building your graph' },
];

function getStageIndex(progress) {
  const { threads_done = 0, threads_total = 1 } = progress;
  const pct = threads_done / threads_total;
  if (pct < 0.33) return 0;
  if (pct < 0.66) return 1;
  return 2;
}

export default function ProgressScreen() {
  const router = useRouter();
  const onboardingProgress = useAuthStore((s) => s.onboardingProgress);
  const _clearPoll = useAuthStore((s) => s._clearPoll);

  useOnboardingPolling();

  const { threads_done = 0, threads_total = 1, queue_position = 0 } = onboardingProgress;
  const pct = threads_total > 0 ? threads_done / threads_total : 0;
  const stageIdx = getStageIndex(onboardingProgress);

  const barWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(barWidth, {
      toValue: pct,
      duration: T.motionBase,
      useNativeDriver: false,
    }).start();
  }, [pct]);

  const handleSkip = () => {
    _clearPoll();
    router.replace('/(tabs)');
  };

  return (
    <ScrollView contentContainerStyle={s.container} bounces={false}>
      <View style={s.hero}>
        <Text style={s.spinnerEmoji}>⚙️</Text>
        <Text style={s.title}>Building your workspace…</Text>
        <Text style={s.tagline}>{BRAND.tagline}</Text>
      </View>

      <View style={s.barTrack}>
        <Animated.View
          style={[s.barFill, { width: barWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
        />
      </View>

      <Text style={s.pctText}>{Math.round(pct * 100)}% complete</Text>

      <View style={s.stages}>
        {STAGES.map((stage, i) => {
          const done = i < stageIdx;
          const active = i === stageIdx;
          return (
            <View key={stage.key} style={s.stageRow}>
              <View style={[s.stageDot, done && s.stageDotDone, active && s.stageDotActive]} />
              <Text style={[s.stageLabel, done && s.stageLabelDone, active && s.stageLabelActive]}>
                {stage.label}
              </Text>
              {done && <Text style={s.checkMark}>✓</Text>}
            </View>
          );
        })}
      </View>

      {queue_position > 0 && (
        <View style={s.queueNotice}>
          <Text style={s.queueText}>
            Position in queue: #{queue_position} — we'll get to you shortly.
          </Text>
        </View>
      )}

      <Pressable style={s.skipBtn} onPress={handleSkip}>
        <Text style={s.skipText}>Skip to Dashboard →</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: T.bg, padding: T.sp6, gap: T.sp6, alignItems: 'center' },
  hero: { alignItems: 'center', gap: T.sp2, marginTop: T.sp8 },
  spinnerEmoji: { fontSize: 48 },
  title: { fontSize: T.textXl, fontWeight: '700', color: T.fg, textAlign: 'center' },
  tagline: { fontSize: T.textXs, color: T.muted, letterSpacing: 0.7 },
  barTrack: {
    width: '100%', height: 8,
    borderRadius: T.radiusPill,
    backgroundColor: T.border,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: T.radiusPill,
    backgroundColor: T.accent,
  },
  pctText: { fontSize: T.textSm, color: T.muted, alignSelf: 'flex-end', marginTop: -T.sp3 },
  stages: { width: '100%', gap: T.sp3 },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: T.sp3 },
  stageDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: T.border },
  stageDotActive: { backgroundColor: T.accent },
  stageDotDone: { backgroundColor: T.accent },
  stageLabel: { flex: 1, fontSize: T.textBase, color: T.muted },
  stageLabelActive: { color: T.fg, fontWeight: '600' },
  stageLabelDone: { color: T.fg2 },
  checkMark: { color: T.accent, fontWeight: '700' },
  queueNotice: {
    backgroundColor: T.warmSurface,
    borderWidth: 1,
    borderColor: T.warmBorder,
    borderRadius: T.radiusSm,
    padding: T.sp4,
    width: '100%',
  },
  queueText: { fontSize: T.textSm, color: T.fg2, textAlign: 'center' },
  skipBtn: { paddingVertical: T.sp3 },
  skipText: { fontSize: T.textSm, color: T.accent, fontWeight: '600' },
});
