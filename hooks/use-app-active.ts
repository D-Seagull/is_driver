import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * True only while the app is on screen (AppState 'active'). A chat screen can
 * stay "focused" in navigation while the app sits in the background with a
 * live socket — read receipts must also require this, or incoming messages
 * get ✓✓ although nobody looked at them.
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) =>
      setActive(s === 'active'),
    );
    return () => sub.remove();
  }, []);
  return active;
}
