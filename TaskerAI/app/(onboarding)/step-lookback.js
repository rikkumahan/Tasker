import { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { T } from '../../components/Theme';
import WizardHeader from '../../components/onboarding/WizardHeader';
import WizardTile from '../../components/onboarding/WizardTile';
import useAuthStore from '../../store/authStore';

const PRESETS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: 'Custom', value: 'custom' },
];

export default function StepLookback() {
  const router = useRouter();
  const lookbackDays = useAuthStore((s) => s.wizardFlags.lookbackDays);
  const setWizardFlags = useAuthStore((s) => s.setWizardFlags);

  const isCustom = !PRESETS.slice(0, 3).some((p) => p.value === lookbackDays);
  const [customValue, setCustomValue] = useState(isCustom ? String(lookbackDays) : '');
  const selected = isCustom ? 'custom' : lookbackDays;

  const handleSelect = (value) => {
    if (value === 'custom') return;
    setWizardFlags({ lookbackDays: value });
  };

  const handleCustomChange = (text) => {
    setCustomValue(text);
    const num = parseInt(text, 10);
    if (!isNaN(num) && num > 0) setWizardFlags({ lookbackDays: num });
  };

  const handleContinue = () => router.push('/(onboarding)/step-tracking');

  return (
    <ScrollView contentContainerStyle={s.container} bounces={false}>
      <WizardHeader step={1} totalSteps={3} />

      <Text style={s.title}>How far back should we look?</Text>
      <Text style={s.subtitle}>We'll scan your Gmail for tasks and commitments in this window.</Text>

      <View style={s.grid}>
        {PRESETS.map((p) => (
          <View key={p.label} style={s.tileWrap}>
            <WizardTile
              label={p.label}
              selected={p.value === 'custom' ? isCustom : selected === p.value}
              onPress={() => {
                if (p.value === 'custom') {
                  setWizardFlags({ lookbackDays: parseInt(customValue, 10) || 14 });
                } else {
                  handleSelect(p.value);
                  setCustomValue('');
                }
              }}
            />
          </View>
        ))}
      </View>

      {isCustom && (
        <TextInput
          style={s.input}
          value={customValue}
          onChangeText={handleCustomChange}
          keyboardType="numeric"
          placeholder="Enter days (e.g. 14)"
          placeholderTextColor={T.muted}
        />
      )}

      <Pressable style={s.btn} onPress={handleContinue}>
        <Text style={s.btnText}>Continue</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: T.bg, padding: T.sp6, gap: T.sp4 },
  title: { fontSize: T.textXl, fontWeight: '700', color: T.fg },
  subtitle: { fontSize: T.textSm, color: T.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: T.sp3 },
  tileWrap: { width: '47%' },
  input: {
    borderWidth: 1.5,
    borderColor: T.accent,
    borderRadius: T.radiusSm,
    paddingHorizontal: T.sp4,
    paddingVertical: T.sp3,
    fontSize: T.textBase,
    color: T.fg,
    backgroundColor: T.surface,
  },
  btn: {
    backgroundColor: T.accent,
    borderRadius: T.radiusSm,
    paddingVertical: T.sp4,
    alignItems: 'center',
    marginTop: T.sp3,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: T.textBase },
});
