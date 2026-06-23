import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { T } from '../../components/Theme';
import { supabase } from '../../lib/supabase';
import WizardHeader from '../../components/onboarding/WizardHeader';
import WizardCheckRow from '../../components/onboarding/WizardCheckRow';
import useAuthStore from '../../store/authStore';

const DEFAULT_LABELS = [
  { id: 'IMPORTANT', label: 'Important', description: 'Gmail starred / important messages' },
  { id: 'INBOX', label: 'Inbox', description: 'All messages in your primary inbox' },
  { id: 'SENT', label: 'Sent', description: 'Commitments you made to others' },
];

export default function StepSources() {
  const router = useRouter();
  const handleWizardComplete = useAuthStore((s) => s.handleWizardComplete);
  const gmailLabels = useAuthStore((s) => s.wizardFlags.gmailLabels);
  const customLabelIds = useAuthStore((s) => s.wizardFlags.customLabelIds);
  const setWizardFlags = useAuthStore((s) => s.setWizardFlags);
  const errorMessage = useAuthStore((s) => s.errorMessage);

  const [syncing, setSyncing] = useState(false);
  const [labelsExpanded, setLabelsExpanded] = useState(false);
  const [userLabels, setUserLabels] = useState([]);
  const [labelsLoading, setLabelsLoading] = useState(false);

  const toggleLabel = (id) => {
    const next = gmailLabels.includes(id)
      ? gmailLabels.filter((x) => x !== id)
      : [...gmailLabels, id];
    setWizardFlags({ gmailLabels: next });
  };

  const toggleCustomLabel = (id) => {
    const next = customLabelIds.includes(id)
      ? customLabelIds.filter((x) => x !== id)
      : [...customLabelIds, id];
    setWizardFlags({ customLabelIds: next });
  };

  const fetchUserLabels = async () => {
    if (userLabels.length > 0) { setLabelsExpanded(true); return; }
    setLabelsLoading(true);
    try {
      const { data } = await supabase.functions.invoke('labels');
      setUserLabels(data?.labels || []);
    } catch (_) {}
    setLabelsLoading(false);
    setLabelsExpanded(true);
  };

  const handleStart = async () => {
    setSyncing(true);
    await handleWizardComplete();
    setSyncing(false);
    if (!errorMessage) router.replace('/(onboarding)/progress');
  };

  return (
    <ScrollView contentContainerStyle={s.container} bounces={false}>
      <WizardHeader step={3} totalSteps={3} />

      <Text style={s.title}>Where should we look?</Text>
      <Text style={s.subtitle}>Choose which Gmail folders to scan for tasks and commitments.</Text>

      <View style={s.checks}>
        {DEFAULT_LABELS.map((lbl) => (
          <WizardCheckRow
            key={lbl.id}
            label={lbl.label}
            description={lbl.description}
            checked={gmailLabels.includes(lbl.id)}
            onToggle={() => toggleLabel(lbl.id)}
          />
        ))}
      </View>

      <Pressable style={s.expandBtn} onPress={fetchUserLabels}>
        {labelsLoading
          ? <ActivityIndicator size="small" color={T.accent} />
          : <Text style={s.expandBtnText}>
              {labelsExpanded ? '▲' : '▼'} Use my Gmail labels
            </Text>
        }
      </Pressable>

      {labelsExpanded && userLabels.length > 0 && (
        <View style={s.customLabels}>
          {userLabels.map((lbl) => (
            <WizardCheckRow
              key={lbl.id}
              label={lbl.name}
              checked={customLabelIds.includes(lbl.id)}
              onToggle={() => toggleCustomLabel(lbl.id)}
            />
          ))}
        </View>
      )}

      {errorMessage ? <Text style={s.error}>{errorMessage}</Text> : null}

      <View style={s.navRow}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backBtnText}>Back</Text>
        </Pressable>
        <Pressable style={[s.btn, syncing && { opacity: 0.7 }]} onPress={handleStart} disabled={syncing}>
          {syncing
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={s.btnText}>Start Syncing</Text>
          }
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
  expandBtn: { paddingVertical: T.sp3, alignItems: 'center' },
  expandBtnText: { fontSize: T.textSm, color: T.accent, fontWeight: '600' },
  customLabels: { gap: T.sp2 },
  error: { fontSize: T.textSm, color: '#ef4444', textAlign: 'center' },
  navRow: { flexDirection: 'row', gap: T.sp3, marginTop: T.sp3 },
  backBtn: {
    flex: 1, borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusSm, paddingVertical: T.sp4, alignItems: 'center',
  },
  backBtnText: { color: T.fg2, fontWeight: '600', fontSize: T.textBase },
  btn: {
    flex: 2, backgroundColor: T.accent,
    borderRadius: T.radiusSm, paddingVertical: T.sp4, alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: T.textBase },
});
