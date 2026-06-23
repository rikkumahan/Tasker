import { Pressable, View, Text, StyleSheet } from 'react-native';
import { T } from '../Theme';

export default function WizardCheckRow({ label, description, checked, onToggle }) {
  return (
    <Pressable style={s.row} onPress={onToggle}>
      <View style={[s.checkbox, checked && s.checkboxChecked]}>
        {checked && <Text style={s.checkmark}>✓</Text>}
      </View>
      <View style={s.text}>
        <Text style={s.label}>{label}</Text>
        {description ? <Text style={s.description}>{description}</Text> : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: T.sp2,
    gap: T.sp3,
  },
  checkbox: {
    width: 22, height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: T.border,
    backgroundColor: T.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: T.accent, borderColor: T.accent },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 16 },
  text: { flex: 1 },
  label: { fontSize: T.textBase, color: T.fg, fontWeight: '500' },
  description: { fontSize: T.textSm, color: T.muted, marginTop: 2 },
});
