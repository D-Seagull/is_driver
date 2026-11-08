import { Ionicons } from '@expo/vector-icons';
import {
  AudioQuality,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { buildWaveform, dbToLevel, waveformToString } from '@/lib/waveform';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Longest voice message, in ms (the server accepts up to ~65 s). */
export const VOICE_MAX_MS = 60 * 1000;
/** Shorter taps are an accident, not a message. */
const VOICE_MIN_MS = 700;

// Speech, not music: mono AAC at 32 kbps is ~240 KB for the full minute.
const VOICE_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 24000,
  numberOfChannels: 1,
  bitRate: 32000,
  // Levels for the waveform drawn in the message bubble.
  isMeteringEnabled: true,
  android: {
    ...RecordingPresets.HIGH_QUALITY.android,
    maxFileSize: 1_500_000,
  },
  ios: {
    ...RecordingPresets.HIGH_QUALITY.ios,
    audioQuality: AudioQuality.MEDIUM,
  },
};

export interface VoiceFile {
  uri: string;
  name: string;
  mimeType: string;
}

/** "0:07" / "12:03". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Records a voice message with expo-audio. `onDone` gets the finished file,
 * its length and its waveform (the "12,40,…" string, null if too short to
 * draw) — only when sent, never for a cancelled or too-short take.
 * The microphone permission is asked on the first recording.
 */
export function useVoiceRecorder(
  onDone: (file: VoiceFile, durationMs: number, waveform: string | null) => void,
) {
  const { t } = useTranslation();
  const recorder = useAudioRecorder(VOICE_OPTIONS);
  const state = useAudioRecorderState(recorder, 200);
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const startedAt = useRef(0);
  const starting = useRef(false);
  // Mic levels (0…1), sampled ten times a second while recording.
  const levels = useRef<number[]>([]);
  const meter = useRef<ReturnType<typeof setInterval> | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const start = useCallback(async () => {
    if (starting.current || activeRef.current) return;
    starting.current = true;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('', t('voice.micDenied'));
        return;
      }
      // iOS: recording needs the session switched on; played back normally
      // afterwards (see finish).
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      levels.current = [];
      meter.current = setInterval(() => {
        const db = recorder.getStatus().metering;
        if (db !== undefined) levels.current.push(dbToLevel(db));
      }, 100);
      activeRef.current = true;
      setActive(true);
    } catch (e) {
      console.warn('[voice] start failed', e);
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      Alert.alert('', t('voice.recordFailed'));
    } finally {
      starting.current = false;
    }
  }, [recorder, t]);

  const finish = useCallback(
    async (send: boolean) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      setActive(false);
      if (meter.current) clearInterval(meter.current);
      meter.current = null;
      const durationMs = Date.now() - startedAt.current;
      try {
        await recorder.stop();
      } catch (e) {
        console.warn('[voice] stop failed', e);
      }
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      const uri = recorder.uri;
      if (!send || !uri || durationMs < VOICE_MIN_MS) return;
      onDoneRef.current(
        { uri, name: `voice-${Date.now()}.m4a`, mimeType: 'audio/mp4' },
        Math.min(durationMs, VOICE_MAX_MS),
        waveformToString(buildWaveform(levels.current)),
      );
    },
    [recorder],
  );

  // The one-minute cap sends what has been recorded.
  useEffect(() => {
    if (active && state.durationMillis >= VOICE_MAX_MS) void finish(true);
  }, [active, state.durationMillis, finish]);

  // Leaving the chat mid-recording throws the take away and frees the mic.
  useEffect(
    () => () => {
      if (meter.current) clearInterval(meter.current);
      if (activeRef.current) {
        activeRef.current = false;
        void recorder.stop().catch(() => undefined);
        void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      }
    },
    [recorder],
  );

  return {
    active,
    elapsedMs: state.durationMillis,
    start,
    send: () => finish(true),
    cancel: () => finish(false),
  };
}

/** The mic that takes the Send button's place while the input is empty. */
export function VoiceMicButton({
  onPress,
  disabled,
}: {
  onPress: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={t('voice.record')}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: c.primary, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      <Ionicons name="mic" size={18} color="#fff" />
    </Pressable>
  );
}

/** Replaces the composer row while recording: cancel · timer · send. */
export function VoiceRecordingBar({
  elapsedMs,
  onCancel,
  onSend,
}: {
  elapsedMs: number;
  onCancel: () => void;
  onSend: () => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={styles.bar}>
      <Pressable
        onPress={onCancel}
        hitSlop={8}
        accessibilityLabel={t('voice.cancel')}
        style={styles.iconBtn}
      >
        <Ionicons name="trash-outline" size={22} color={c.destructive} />
      </Pressable>
      <View style={[styles.timer, { backgroundColor: c.muted }]}>
        <View style={[styles.dot, { backgroundColor: c.destructive }]} />
        <Text style={[styles.time, { color: c.foreground }]}>
          {formatClock(elapsedMs)}
        </Text>
      </View>
      <Pressable
        onPress={onSend}
        accessibilityLabel={t('voice.send')}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Ionicons name="send" size={16} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timer: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  time: { fontSize: 15, fontVariant: ['tabular-nums'] },
});
