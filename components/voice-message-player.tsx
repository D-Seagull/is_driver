import { Ionicons } from '@expo/vector-icons';
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { parseWaveform, placeholderWaveform } from '@/lib/waveform';

import { formatClock } from './voice-recorder';

// One voice message at a time: the one playing is paused when another starts.
let pauseCurrent: (() => void) | null = null;

const SPEEDS = [1, 1.5, 2] as const;

interface Props {
  uri: string;
  /** Length from the server — a recorded file's own header can't be trusted. */
  durationMs?: number | null;
  /** Loudness bars from the server ("12,40,…"); older messages have none. */
  waveform?: string | null;
  /** Own message: drawn on the primary bubble, so light on dark. */
  isOwn: boolean;
}

/**
 * Voice message in a chat bubble: play / pause, the waveform (tap to seek), the length (counting up while playing) and a 1× / 1.5× / 2× toggle.
 *
 * The native player is created only on the first tap — a long chat holds
 * many of these, and an idle one must cost nothing.
 */
export function VoiceMessagePlayer(props: Props) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <PlayerView {...props} onPlay={() => setArmed(true)} />;
  return <LivePlayer {...props} />;
}

function LivePlayer({ uri, durationMs, waveform, isOwn }: Props) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const [speedIdx, setSpeedIdx] = useState(0);

  useEffect(() => {
    // Plays through the silent switch; stops whichever one was playing.
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
    pauseCurrent?.();
    pauseCurrent = () => player.pause();
    player.play();
    return () => {
      if (pauseCurrent) pauseCurrent = null;
    };
  }, [player]);

  // Played to the end → back to the start, ready to play again.
  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [status.didJustFinish, player]);

  const totalMs =
    durationMs || (Number.isFinite(status.duration) ? status.duration * 1000 : 0);
  const currentMs = status.currentTime * 1000;

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (pauseCurrent) pauseCurrent();
    pauseCurrent = () => player.pause();
    player.setPlaybackRate(SPEEDS[speedIdx]);
    player.play();
  };

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    player.setPlaybackRate(SPEEDS[next]);
  };

  return (
    <PlayerView
      uri={uri}
      durationMs={durationMs}
      waveform={waveform}
      isOwn={isOwn}
      playing={status.playing}
      currentMs={currentMs}
      totalMs={totalMs}
      speed={SPEEDS[speedIdx]}
      onPlay={toggle}
      onSeek={(ratio) => {
        if (totalMs) void player.seekTo((ratio * totalMs) / 1000);
      }}
      onSpeed={cycleSpeed}
    />
  );
}

/** The drawing — shared by the idle (no player yet) and the live state. */
function PlayerView({
  isOwn,
  durationMs,
  waveform,
  playing = false,
  currentMs = 0,
  totalMs,
  speed = 1,
  onPlay,
  onSeek,
  onSpeed,
}: Props & {
  playing?: boolean;
  currentMs?: number;
  totalMs?: number;
  speed?: number;
  onPlay: () => void;
  onSeek?: (ratio: number) => void;
  onSpeed?: () => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [barWidth, setBarWidth] = useState(0);

  const total = totalMs ?? durationMs ?? 0;
  const progress = total ? Math.min(1, currentMs / total) : 0;
  const fg = isOwn ? c.primaryForeground : c.foreground;
  const muted = isOwn ? `${c.primaryForeground}B3` : c.mutedForeground;
  const track = isOwn ? `${c.primaryForeground}55` : `${c.primary}40`;
  const fill = isOwn ? c.primaryForeground : c.primary;
  const bars = parseWaveform(waveform) ?? placeholderWaveform();
  const playedBars = Math.round(progress * bars.length);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPlay}
        accessibilityLabel={playing ? t('voice.pause') : t('voice.play')}
        style={[
          styles.playBtn,
          { backgroundColor: isOwn ? `${c.primaryForeground}33` : `${c.primary}1A` },
        ]}
      >
        <Ionicons
          name={playing ? 'pause' : 'play'}
          size={18}
          color={isOwn ? c.primaryForeground : c.primary}
          style={playing ? undefined : { marginLeft: 2 }}
        />
      </Pressable>
      <View style={styles.mid}>
        <Pressable
          disabled={!onSeek}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
          onPress={(e) => {
            if (barWidth > 0) {
              onSeek?.(Math.min(1, Math.max(0, e.nativeEvent.locationX / barWidth)));
            }
          }}
          hitSlop={{ top: 6, bottom: 6 }}
          style={styles.wave}
        >
          {bars.map((v, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: 3 + (v / 100) * 21,
                  backgroundColor: i < playedBars ? fill : track,
                },
              ]}
            />
          ))}
        </Pressable>
        <Text style={[styles.time, { color: muted }]}>
          {formatClock(playing || currentMs > 0 ? currentMs : total)}
        </Text>
      </View>
      <Pressable onPress={onSpeed} disabled={!onSpeed} hitSlop={8}>
        <Text style={[styles.speed, { color: onSpeed ? fg : muted }]}>{speed}×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: 250,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mid: { flex: 1, gap: 4 },
  wave: { height: 26, flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { flex: 1, borderRadius: 2, minWidth: 2 },
  time: { fontSize: 11, fontVariant: ['tabular-nums'] },
  speed: { fontSize: 11, fontWeight: '700', width: 26, textAlign: 'center' },
});
