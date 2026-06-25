import { View, Text, StyleSheet } from 'react-native';
import { T } from '../Theme';
import { BRAND } from '../../lib/brand';

export default function WizardHeader({ step, totalSteps = 3 }) {
  return (
    <View style={s.container}>
      <View style={s.wordmark}>
        <Text style={s.primary}>{BRAND.wordmark.primary}</Text>
        <Text style={s.accent}>{BRAND.wordmark.accent}</Text>
      </View>

      {step != null && (
        <View style={s.stepRow}>
          <Text style={s.stepText}>Step {step} of {totalSteps}</Text>
          <View style={s.dots}>
            {Array.from({ length: totalSteps }, (_, i) => (
              <View
                key={i}
                style={[s.dot, i + 1 === step && s.dotActive]}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { alignItems: 'center', paddingBottom: T.sp4 },
  wordmark: { flexDirection: 'row', alignItems: 'baseline', marginBottom: T.sp4 },
  primary: { fontSize: T.textXl, fontWeight: '700', color: T.fg },
  accent: { fontSize: T.textXl, fontWeight: '700', color: T.accent },
  stepRow: { alignItems: 'center', gap: T.sp1 },
  stepText: { fontSize: T.textXs, color: T.muted },
  dots: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: T.border,
  },
  dotActive: { backgroundColor: T.accent },
});
