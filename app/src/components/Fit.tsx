import { type ReactNode, useState } from 'react';
import { View } from 'react-native';

/** Keeps content inside its box: on a short screen, or with big phone text, it shrinks to fit
 *  instead of running off the bottom. Children should grow with their content (flexGrow, not flex: 1). */
export function Fit({ children, min = 0.7 }: { children: ReactNode; min?: number }) {
  const [room, setRoom] = useState(0);
  const [need, setNeed] = useState(0);
  const scale = room > 0 && need > room + 1 ? Math.max(min, room / need) : 1;
  return (
    <View style={{ flex: 1, overflow: 'hidden' }} onLayout={(e) => setRoom(e.nativeEvent.layout.height)}>
      <View
        style={{ minHeight: room || undefined, transformOrigin: 'top', transform: [{ scale }] }}
        onLayout={(e) => setNeed(e.nativeEvent.layout.height)}
      >
        {children}
      </View>
    </View>
  );
}
