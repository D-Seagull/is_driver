import { Ionicons } from '@expo/vector-icons';
import {
  AudioModule,
  AudioQuality,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { createRecordingOptions } from 'expo-audio/build/utils/options';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { buildWaveform, dbToLevel, formatClock, waveformToString } from '@/lib/waveform';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { VoiceMessagePlayer } from './voice-message-player';

/** Longest voice message, in ms (the server accepts up to ~65 s). */
export const VOICE_MAX_MS = 60 * 1000;
/** Shorter holds are an accident, not a message. */
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

/** A finished take waiting for the user to listen to it and send (or drop) it. */
export interface VoiceDraft {
  file: VoiceFile;
  durationMs: number;
  /** The "12,40,…" string for the bubble, null when too short to draw. */
  waveform: string | null;
}

/**
 * Voice message in two steps: HOLD the mic to record, let go to get a draft
 * you can play back, then send it (or throw it away). `onSend` gets the file,
 * its length and its waveform ("12,40,…", null if too short to draw) — only
 * for a draft that was sent. The microphone permission is asked on the first
 * hold.
 */
export function useVoiceRecorder(
  onSend: (file: VoiceFile, durationMs: number, waveform: string | null) => void,
) {
  const { t } = useTranslation();
  // The native recorder is created on the first hold, never on opening a
  // chat — an idle chat must not touch the microphone module at all.
  const recorderRef = useRef<AudioRecorder | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const activeRef = useRef(false);
  const holding = useRef(false);
  const startedAt = useRef(0);
  const starting = useRef(false);
  // Mic levels (0…1), sampled ten times a second while recording.
  const levels = useRef<number[]>([]);
  const meter = useRef<ReturnType<typeof setInterval> | null>(null);
  const onSendRef = useRef(onSend);
  useEffect(() => {
    onSendRef.current = onSend;
  });

  const releaseRecorder = useCallback(() => {
    const r = recorderRef.current;
    recorderRef.current = null;
    try {
      r?.release();
    } catch {
      /* already gone */
    }
  }, []);

  /** Stops the recorder; keeps the take as a draft, or throws it away. */
  const finish = useCallback(
    async (keep: boolean) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      setRecording(false);
      if (meter.current) clearInterval(meter.current);
      meter.current = null;
      const durationMs = Date.now() - startedAt.current;
      const recorder = recorderRef.current;
      try {
        await recorder?.stop();
      } catch (e) {
        console.warn('[voice] stop failed', e);
      }
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      const uri = recorder?.uri;
      releaseRecorder();
      if (!keep || !uri) return;
      if (durationMs < VOICE_MIN_MS) {
        // A tap, not a hold: say how it works.
        if (Platform.OS === 'android') {
          ToastAndroid.show(t('voice.holdHint'), ToastAndroid.SHORT);
        }
        return;
      }
      setDraft({
        file: { uri, name: `voice-${Date.now()}.m4a`, mimeType: 'audio/mp4' },
        durationMs: Math.min(durationMs, VOICE_MAX_MS),
        waveform: waveformToString(buildWaveform(levels.current)),
      });
    },
    [releaseRecorder, t],
  );

  const start = useCallback(async () => {
    if (starting.current || activeRef.current) return;
    starting.current = true;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('', t('voice.micDenied'));
        return;
      }
      // Let go while the permission dialog was up: nothing to record.
      if (!holding.current) return;
      // iOS: recording needs the session switched on; played back normally
      // afterwards (see finish).
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      // eslint-disable-next-line import/namespace -- AudioModule is a native object, not an ES namespace
      const recorder = new AudioModule.AudioRecorder(createRecordingOptions(VOICE_OPTIONS));
      recorderRef.current = recorder;
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      levels.current = [];
      setElapsedMs(0);
      meter.current = setInterval(() => {
        const st = recorder.getStatus();
        if (st.metering !== undefined) levels.current.push(dbToLevel(st.metering));
        setElapsedMs(Date.now() - startedAt.current);
      }, 100);
      activeRef.current = true;
      setRecording(true);
    } catch (e) {
      console.warn('[voice] start failed', e);
      if (meter.current) clearInterval(meter.current);
      meter.current = null;
      releaseRecorder();
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      Alert.alert('', t('voice.recordFailed'));
    } finally {
      starting.current = false;
    }
  }, [releaseRecorder, t]);

  const startHold = useCallback(async () => {
    holding.current = true;
    setDraft(null);
    await start();
    // Released before the recorder was up (slow start): drop the take.
    if (!holding.current && activeRef.current) void finish(false);
  }, [start, finish]);

  const endHold = useCallback(() => {
    holding.current = false;
    if (activeRef.current) void finish(true);
  }, [finish]);

  // The one-minute cap stops the recording; the finger may still be down.
  useEffect(() => {
    if (recording && elapsedMs >= VOICE_MAX_MS) void finish(true);
  }, [recording, elapsedMs, finish]);

  // Leaving the chat mid-recording throws the take away and frees the mic.
  useEffect(
    () => () => {
      if (meter.current) clearInterval(meter.current);
      if (activeRef.current) {
        activeRef.current = false;
        void recorderRef.current?.stop().catch(() => undefined);
        void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      }
      releaseRecorder();
    },
    [releaseRecorder],
  );

  return {
    recording,
    draft,
    elapsedMs,
    startHold,
    endHold,
    /** Sends the draft that was listened to. */
    sendDraft: () => {
      if (!draft) return;
      const d = draft;
      setDraft(null);
      onSendRef.current(d.file, d.durationMs, d.waveform);
    },
    discardDraft: () => setDraft(null),
  };
}

/**
 * The mic that takes the Send button's place while the input is empty.
 * HOLD to record, let go to stop. It stays mounted for the whole hold (the
 * rest of the composer changes around it), so the gesture is not lost.
 */
export function VoiceMicButton({
  onHoldStart,
  onHoldEnd,
  recording,
  disabled,
}: {
  onHoldStart: () => void;
  onHoldEnd: () => void;
  recording: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable
      onPressIn={onHoldStart}
      onPressOut={onHoldEnd}
      disabled={disabled}
      accessibilityLabel={t('voice.record')}
      style={[
        styles.btn,
        recording && styles.btnRecording,
        {
          backgroundColor: recording ? c.destructive : c.primary,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Ionicons name="mic" size={recording ? 22 : 18} color="#fff" />
    </Pressable>
  );
}

/** Replaces the composer's left side while the mic is held: timer + hint. */
export function VoiceRecordingBar({ elapsedMs }: { elapsedMs: number }) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={styles.bar}>
      <View style={[styles.timer, { backgroundColor: c.muted }]}>
        <View style={[styles.dot, { backgroundColor: c.destructive }]} />
        <Text style={[styles.time, { color: c.foreground }]}>
          {formatClock(elapsedMs)}
        </Text>
        <Text style={[styles.hint, { color: c.mutedForeground }]} numberOfLines={1}>
          {t('voice.release')}
        </Text>
      </View>
    </View>
  );
}

/** After the hold: listen to the take (and throw it away), then Send. */
export function VoicePreviewBar({
  draft,
  onDiscard,
}: {
  draft: VoiceDraft;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={styles.bar}>
      <Pressable
        onPress={onDiscard}
        hitSlop={8}
        accessibilityLabel={t('voice.cancel')}
        style={styles.iconBtn}
      >
        <Ionicons name="trash-outline" size={22} color={c.destructive} />
      </Pressable>
      <View style={[styles.preview, { backgroundColor: c.muted }]}>
        <VoiceMessagePlayer
          uri={draft.file.uri}
          durationMs={draft.durationMs}
          waveform={draft.waveform}
          isOwn={false}
          fullWidth
        />
      </View>
    </View>
  );
}

/** Sends the draft — same look as the composer's Send button. */
export function VoiceSendButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={t('voice.send')}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Ionicons name="send" size={16} color="#fff" />
    </Pressable>
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
  btnRecording: { transform: [{ scale: 1.25 }] },
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
  preview: { flex: 1, borderRadius: 19, overflow: 'hidden' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  time: { fontSize: 15, fontVariant: ['tabular-nums'] },
  hint: { flex: 1, fontSize: 12, textAlign: 'right' },
});
