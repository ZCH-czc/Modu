import {
  Ionicons } from '@expo/vector-icons';
import { Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from "../i18n";
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTab } from '../types';

export function BottomNav({
  active,
  onChange,
}: {
  active: AppTab;
  onChange: (tab: AppTab) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(8, insets.bottom) }]}>
      <Item
        label="书架"
        icon="library-outline"
        activeIcon="library"
        selected={active === 'shelf'}
        onPress={() => onChange('shelf')}
      />
      <View style={styles.logo}>
        <Text style={styles.logoText}>墨</Text>
      </View>
      <Item
        label="设置"
        icon="options-outline"
        activeIcon="options"
        selected={active === 'settings'}
        onPress={() => onChange('settings')}
      />
    </View>
  );
}

function Item({
  label,
  icon,
  activeIcon,
  selected,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
      <Ionicons
        name={selected ? activeIcon : icon}
        size={23}
        color={selected ? '#315D4B' : '#9A958C'}
      />
      <Text style={[styles.label, selected && styles.selected]}>{label}</Text>
      {selected && <View style={styles.dot} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 64,
    paddingTop: 8,
    paddingHorizontal: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#DDD8CE',
    backgroundColor: '#FCFAF6',
  },
  item: { width: 72, height: 52, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.55, transform: [{ scale: 0.94 }] },
  label: { color: '#9A958C', fontSize: 11, marginTop: 3 },
  selected: { color: '#315D4B', fontWeight: '800' },
  dot: {
    position: 'absolute',
    bottom: 0,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C7A467',
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#315D4B',
    transform: [{ rotate: '-6deg' }],
  },
  logoText: { color: '#F7E9CB', fontSize: 17, fontWeight: '900' },
});
