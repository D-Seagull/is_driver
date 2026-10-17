import type { ReactElement } from 'react';
// The one module allowed to use the raw lists — see eslint.config.js.
// eslint-disable-next-line no-restricted-imports
import { FlatList, ScrollView, type FlatListProps, type ScrollViewProps } from 'react-native';

import { useListBottomPadding } from '@/hooks/use-list-bottom-padding';

interface InsetProps {
  /** Space under the last row, above the Android nav bar (default Spacing.md). */
  bottomGap?: number;
  /** Add the home-indicator inset on iOS too (default: Android only). */
  insetIOS?: boolean;
}

/*
 * Every vertical list and scroll screen goes through these, never a bare
 * FlatList / ScrollView (a lint rule enforces it). Android is edge-to-edge,
 * so a bare list's last rows slide under the system nav bar; these always add
 * the bottom inset there. Fixing it screen by screen kept coming back with
 * every new screen, so it is structural now (2026-10-17).
 *
 * `paddingBottom` from contentContainerStyle is overridden — set `bottomGap`.
 */

export function InsetFlatList<T>({
  bottomGap,
  insetIOS,
  contentContainerStyle,
  ...rest
}: FlatListProps<T> & InsetProps): ReactElement {
  const pad = useListBottomPadding(bottomGap, { ios: insetIOS });
  return (
    <FlatList
      {...rest}
      contentContainerStyle={[contentContainerStyle, { paddingBottom: pad }]}
    />
  );
}

export function InsetScrollView({
  bottomGap,
  insetIOS,
  contentContainerStyle,
  ...rest
}: ScrollViewProps & InsetProps): ReactElement {
  const pad = useListBottomPadding(bottomGap, { ios: insetIOS });
  return (
    <ScrollView
      {...rest}
      contentContainerStyle={[contentContainerStyle, { paddingBottom: pad }]}
    />
  );
}
