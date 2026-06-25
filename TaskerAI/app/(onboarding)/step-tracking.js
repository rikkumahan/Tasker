import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { T } from '../../components/Theme';
import WizardHeader from '../../components/onboarding/WizardHeader';
import WizardCheckRow from '../../components/onboarding/WizardCheckRow';
import useAuthStore from '../../store/authStore';

const TRACKING_OPTIONS = [
  { id: 'tasks', label: 'Tasks', description: 'Action items assigned to you or others' },
  { id: 'deadlines', label: 'Deadlines', description: 'Due dates and time-sensitive items' },
  { id: 'people', label: 'People', description: 'Commitments made to or by specific contacts' },
  { id: 'projects', label: 'Projects', description: 'Multi-thread work grouped by topic' },
];

export default function StepTracking() {
  const router = useRouter();
  const trackingPrefs = useAuthStore((s) => s.wizardFlags.trackingPrefs);
  const otherText = useAuthStore((s) => s.wizardFlags.otherText);
  const setWizardFlags = useAuthStore((s) => s.setWizardFlags);

  const toggle = (id) => {
    const next = trackingPrefs.includes(id)
      ? trackingPrefs.filter((x) => x !== id)
      : [...trackingPrefs, id];
    setWizardFlags({ trackingPrefs: next });
  };

  return (
    <ScrollView contentContainerStyle={s.container} bounces={false}>
      <WizardHeader step={2} totalSteps={3} />

      <Text style={s.title}>What matters to you?</Text>
      <Text style={s.subtitle}>We'll prioritize extracting these from your emails.</Text>

      <View style={s.checks}>
        {TRACKING_OPTIONS.map((opt) => (
          <WizardCheckRow
            key={opt.id}
            label={opt.label}
            description={opt.description}
            checked={trackingPrefs.includes(opt.id)}
            onToggle={() => toggle(opt.id)}
          />
        ))}
      </View>

      <Text style={s.otherLabel}>Other (optional)</Text>
      <TextInput
        style={s.input}
        value={otherText}
        onChangeText={(t) => setWizardFlags({ otherText: t })}
        placeholder="e.g. Invoices, Legal reviews..."
        placeholderTextColor={T.muted}
      />

      <View style={s.navRow}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backBtnText}>Back</Text>
        </Pressable>
        <Pressable style={s.btn} onPress={() => router.push('/(onboarding)/step-sources')}>
          <Text style={s.btnText}>Continue</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: T.bg, padding: T.sp6, gap: T.sp4 },
  title: { fontSize: T.textXl, fontWeight: '700', color: T.fg },
  subtitle: { fontSize: T.textSm, color: T.muted },
  checks: { gap: T.sp2 },
  otherLabel: { fontSize: T.textSm, color: T.fg2, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radiusSm,
    paddingHorizontal: T.sp4,
    paddingVertical: T.sp3,
    fontSize: T.textBase,
    color: T.fg,
    backgroundColor: T.surface,
  },
  navRow: { flexDirection: 'row', gap: T.sp3, marginTop: T.sp3 },
  backBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radiusSm,
    paddingVertical: T.sp4,
    alignItems: 'center',
  },
  backBtnText: { color: T.fg2, fontWeight: '600', fontSize: T.textBase },
  btn: {
    flex: 2,
    backgroundColor: T.accent,
    borderRadius: T.radiusSm,
    paddingVertical: T.sp4,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: T.textBase },
});
