import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Per-device notification feedback preferences: whether an incoming chat
 * message plays a chime and/or triggers a one-shot vibration. Both default on
 * and are toggled independently from Settings. Persisted locally (not on the
 * server) — this is a device preference, not a profile field.
 */
type AlertPrefsState = {
  sound: boolean;
  vibration: boolean;
  setSound: (v: boolean) => void;
  setVibration: (v: boolean) => void;
};

export const useAlertPrefs = create<AlertPrefsState>()(
  persist(
    (set) => ({
      sound: true,
      vibration: true,
      setSound: (v) => set({ sound: v }),
      setVibration: (v) => set({ vibration: v }),
    }),
    {
      name: 'alert-prefs',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
