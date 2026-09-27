import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'saved-story-ids';

/** Saved stories live only on this device. No account needed. */
export function useSaved() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => setIds(raw ? JSON.parse(raw) : []))
      .catch(() => setIds([]));
  }, []);

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return { savedIds: ids, isSaved: (id: string) => ids.includes(id), toggleSaved: toggle };
}
