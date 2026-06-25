import { useRef, useEffect } from 'react';
import { Pressable, Text, Animated, StyleSheet } from 'react-native';
import { T } from '../Theme';

export default function WizardTile({ label, selected, onPress }) {
  const borderAnim = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(borderAnim, {
      toValue: selected ? 1 : 0,
      duration: T.motionFast,
      useNativeDriver: false,
    }).start();
  }, [selected]);

  const borderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [T.border, T.accent],
  });

  const bgColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [T.surface, T.accentTint],
  });

  return (
    <Pressable onPress={onPress}>
      <Animated.View style={[s.tile, { borderColor, backgroundColor: bgColor }]}>
        <Text style={[s.label, selected && s.labelSelected]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  tile: {
    borderWidth: 1.5,
    borderRadius: T.radiusSm,
    paddingVertical: T.sp4,
    paddingHorizontal: T.sp4,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 64,
  },
  label: { fontSize: T.textBase, color: T.fg2, fontWeight: '500' },
  labelSelected: { color: T.accent, fontWeight: '600' },
});
