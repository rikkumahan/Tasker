import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { T } from '../Theme';

export default function ServiceCard({ icon, name, description, badge, onConnect, loading, primary }) {
  return (
    <View style={s.card}>
      <View style={s.top}>
        <View style={s.iconWrap}>{icon}</View>
        <View style={s.info}>
          <View style={s.nameRow}>
            <Text style={s.name}>{name}</Text>
            {badge ? <View style={s.badge}><Text style={s.badgeText}>{badge}</Text></View> : null}
          </View>
          <Text style={s.description}>{description}</Text>
        </View>
      </View>

      <Pressable
        onPress={onConnect}
        disabled={loading || !onConnect}
        style={({ pressed }) => [s.btnWrap, pressed && { opacity: 0.85 }]}
      >
        {primary ? (
          <LinearGradient colors={T.logoGrad} style={s.btn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.btnTextPrimary}>Connect</Text>
            }
          </LinearGradient>
        ) : (
          <View style={[s.btn, s.btnMuted]}>
            <Text style={s.btnTextMuted}>{badge || 'Coming Soon'}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: T.radiusMd,
    padding: T.sp4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 4,
    gap: T.sp3,
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: T.sp3 },
  iconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: T.sp2, marginBottom: 4 },
  name: { fontSize: T.textBase, fontWeight: '600', color: T.fg },
  badge: {
    backgroundColor: T.surfaceWarm,
    borderRadius: T.radiusPill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { fontSize: T.textXs, color: T.muted },
  description: { fontSize: T.textSm, color: T.muted },
  btnWrap: {},
  btn: {
    borderRadius: T.radiusSm,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnMuted: { backgroundColor: T.surfaceWarm },
  btnTextPrimary: { color: '#fff', fontWeight: '600', fontSize: T.textSm },
  btnTextMuted: { color: T.muted, fontWeight: '500', fontSize: T.textSm },
});
