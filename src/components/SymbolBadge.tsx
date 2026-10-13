import { StyleSheet, Text, View } from 'react-native';
import type { SymbolType } from '../types';

type Props = { type: SymbolType; size?: number };

export function SymbolBadge({ type, size = 36 }: Props) {
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: type.color },
      ]}
    >
      <Text style={[styles.text, { fontSize: size * (Array.from(type.short).length > 1 ? 0.38 : 0.5) }]}>
        {type.short}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  text: { color: 'white', fontWeight: '800' },
});
