import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { dDayLabel, isEnded } from '@/lib/challenge/browse';
import {
  buildEntryBody,
  canSubmitEntry,
  captionTooLong,
  doneCopy,
  entryAttemptFor,
  entryFailure,
  entryFailureMessage,
  entryFingerprint,
  videoTooLong,
  type EntryAttempt,
} from '@/lib/challenge/entry';
import { CAPTION_MAX, type ChallengeDetail, type EntryVisibility } from '@/lib/challenge/types';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import { confirmedVideoFor, flushLibraryUploads, localCopyFor, onLibraryChange, saveRecordingToLibrary } from '@/lib/library/library-runner';
import { takeRecordedVideo } from '@/lib/recorded-video';

/**
 * A18.1·A18.2 올리기 → A18.3 완료(challenge.entry).
 *
 * 영상은 보관함의 확정된 영상(video_id)이거나 방금 찍은 것이다 — 찍은 것은 보관함 큐가 확정한
 * 뒤에 올린다(영상은 연습과 같은 videos 를 쓴다). 공개 범위는 여기서 **명시적으로** 고르고,
 * 공개를 고르면 다른 참여자의 AI 리포트 비교에 쓰일 수 있다는 것을 한 줄 알린다. 같은 시도의
 * 재전송은 같은 요청 id 라 참여작은 하나다. 완료 문구는 공개와 비공개가 다르다.
 */
export default function ChallengeUploadScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ challengeId?: string; videoId?: string; line?: string; work?: string }>();
  const challengeId = params.challengeId ?? null;

  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [videoId, setVideoId] = useState<string | null>(params.videoId ?? null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<EntryVisibility | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<EntryVisibility | null>(null);
  /** 방금 만든 참여작 — 완료 화면의 "AI 리포트 받기"가 쓴다. */
  const [entryId, setEntryId] = useState<string | null>(null);
  const attemptRef = useRef<EntryAttempt | null>(null);
  const lockRef = useRef(false);

  const player = useVideoPlayer(localUri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // 방금 찍은 영상은 보관함에 저장해 확정되기를 기다린다(영상은 보관함에 남는다).
  useEffect(() => {
    const recorded = takeRecordedVideo();
    if (!recorded || !user?.id || params.videoId) return;
    setLocalUri(recorded.uri);
    if (videoTooLong(recorded.durationMs)) {
      setError(t('challengeUpload.errTooLong'));
      return;
    }
    void saveRecordingToLibrary({ uri: recorded.uri, durationMs: recorded.durationMs, owner: user.id }).then((outcome) => {
      if (outcome.kind === 'queued') setPendingId(outcome.entry.id);
      else setError(t('challengeUpload.errTooLong'));
    });
  }, [params.videoId, user?.id]);

  // 대기 중이던 촬영본이 확정되면 그 영상 id 로 올린다.
  useEffect(() => {
    if (!pendingId || videoId) return;
    const check = () => {
      const confirmed = confirmedVideoFor(pendingId);
      if (confirmed) setVideoId(confirmed);
    };
    check();
    return onLibraryChange(check);
  }, [pendingId, videoId]);

  // 보관함에서 고른 영상은 기기 복사본이 있으면 미리보기로 쓴다.
  useEffect(() => {
    if (!params.videoId) return;
    void localCopyFor(params.videoId).then((uri) => uri && setLocalUri(uri));
  }, [params.videoId]);

  useEffect(() => {
    if (!challengeId) return;
    void api
      .getChallenge(challengeId)
      .then(setChallenge)
      .catch(() => setError(t('challenges.notFound')));
  }, [challengeId]);

  const submit = useCallback(async () => {
    if (!challengeId || lockRef.current || submitting) return;
    if (!visibility) return;
    if (!videoId) {
      // 아직 올리는 중이면 한 번 밀어 보고 안내한다.
      if (pendingId && user?.id) await flushLibraryUploads(user.id);
      const confirmed = pendingId ? confirmedVideoFor(pendingId) : null;
      if (!confirmed) {
        setError(t('challengeUpload.waitingVideo'));
        return;
      }
      setVideoId(confirmed);
      return;
    }
    lockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const body = buildEntryBody({ requestId: 'pending', videoId, caption, visibility });
      const attempt = entryAttemptFor(attemptRef.current, entryFingerprint(body), () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      attemptRef.current = attempt;
      const entry = await api.createEntry(challengeId, { ...body, request_id: attempt.requestId });
      setEntryId(entry.id);
      logEvent('challenge_entry_created', { visibility });
      setDone(visibility);
    } catch (e) {
      const failure = entryFailure(e);
      if (failure.kind === 'fingerprint_mismatch') attemptRef.current = null;
      setError(entryFailureMessage(failure));
    } finally {
      lockRef.current = false;
      setSubmitting(false);
    }
  }, [caption, challengeId, pendingId, submitting, user?.id, videoId, visibility]);

  /**
   * "AI 리포트 받기"(A18.3) — 같은 대사의 다른 참여작과 견주는 챌린지 리포트로 간다.
   * 공개·비공개 참여작 모두 요청할 수 있다(challenge.ai-report).
   */
  const getReport = () => {
    logEvent('challenge_upload_report', { visibility: done ?? 'none' });
    if (!entryId) {
      router.replace('/challenges');
      return;
    }
    router.replace({ pathname: '/ai-report', params: { entryId } });
  };

  if (done) {
    const copy = doneCopy(done);
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.doneWrap}>
          <View style={styles.doneIcon}>
            <Feather name="check" size={30} color={palette.blue} />
          </View>
          <Text style={styles.doneTitle}>{copy.title}</Text>
          <Text style={styles.doneSub}>{copy.body}</Text>
          <Pressable
            style={({ pressed }) => [styles.primary, styles.doneBtn, pressed && styles.pressed]}
            onPress={() =>
              challengeId
                ? router.replace({ pathname: '/challenge-detail', params: { id: challengeId } })
                : router.replace('/')
            }
            accessibilityRole="button">
            <Text style={styles.primaryText}>{t('challengeUpload.goHome')}</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.ghost, styles.doneBtn, pressed && styles.pressed]} onPress={getReport} accessibilityRole="button">
            <Text style={styles.ghostText}>{t('challengeUpload.getReport')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const uploading = Boolean(pendingId && !videoId);
  const ready = canSubmitEntry({ videoId, visibility, caption }) && !uploading;
  const ended = challenge ? isEnded(challenge) : false;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('challengeUpload.title') }} />
      <KeyboardAwareScroll contentContainerStyle={styles.content}>
        <View style={styles.headRow}>
          <View style={styles.thumbWrap}>
            {localUri ? (
              <VideoView style={styles.thumb} player={player} contentFit="cover" nativeControls={false} />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <Feather name="video" size={18} color={palette.textFaint} />
              </View>
            )}
          </View>
          <View style={styles.flex}>
            <Text style={styles.meta} numberOfLines={2}>
              {challenge ? `“${challenge.line}”` : (params.line ?? '')}
            </Text>
            <Text style={styles.metaSub}>
              {[challenge?.work ?? params.work ?? '', challenge ? dDayLabel(challenge) : ''].filter(Boolean).join(' · ')}
            </Text>
            <TextInput
              style={styles.caption}
              placeholder={t('challengeUpload.captionPh')}
              placeholderTextColor={palette.textFaint}
              value={caption}
              onChangeText={setCaption}
              maxLength={CAPTION_MAX}
              multiline
            />
            <Text style={styles.counter}>
              {t('challengeUpload.captionCounter', { count: [...caption].length, max: CAPTION_MAX })}
            </Text>
          </View>
        </View>

        <Text style={styles.pickLabel}>{t('challengeUpload.pickVisibility')}</Text>
        <Option
          icon="globe"
          title={t('challengeUpload.optPublic')}
          sub={t('challengeUpload.optPublicSub')}
          selected={visibility === 'public'}
          onPress={() => setVisibility('public')}
        />
        <Option
          icon="lock"
          title={t('challengeUpload.optPrivate')}
          sub={t('challengeUpload.optPrivateSub')}
          selected={visibility === 'private'}
          onPress={() => setVisibility('private')}
        />

        {/* 공개를 고르면 표본 활용을 한 줄로 알린다(challenge.ai-report). */}
        {visibility === 'public' && (
          <View style={styles.note}>
            <Feather name="zap" size={13} color={palette.blueDeep} />
            <Text style={styles.noteText}>{t('challengeUpload.note')}</Text>
          </View>
        )}

        {uploading && <Text style={styles.hint}>{t('challengeUpload.waitingVideo')}</Text>}
        {captionTooLong(caption) && <Text style={styles.error}>{t('challengeUpload.errInvalid')}</Text>}
        {ended && <Text style={styles.error}>{t('challengeUpload.errClosed')}</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </KeyboardAwareScroll>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.primary, (!ready || submitting || ended) && styles.primaryOff, pressed && styles.pressed]}
          onPress={() => void submit()}
          disabled={!ready || submitting || ended}
          accessibilityRole="button">
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryText}>
              {t(visibility === 'private' ? 'challengeUpload.submitPrivate' : 'challengeUpload.submit')}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Option({
  icon,
  title,
  sub,
  selected,
  onPress,
}: {
  icon: 'globe' | 'lock';
  title: string;
  sub: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.option, selected && styles.optionOn]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}>
      <View style={[styles.optionIcon, selected && styles.optionIconOn]}>
        <Feather name={icon} size={18} color={selected ? palette.blue : palette.textFaint} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.optionTitle, selected && styles.optionTitleOn]}>{title}</Text>
        <Text style={styles.optionSub}>{sub}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>{selected && <View style={styles.radioDot} />}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },
  content: { padding: 20, gap: 14, paddingBottom: 24 },
  headRow: { flexDirection: 'row', gap: 12 },
  thumbWrap: { width: 72, aspectRatio: 9 / 16, borderRadius: 12, overflow: 'hidden', backgroundColor: palette.text },
  thumb: { width: '100%', height: '100%' },
  thumbEmpty: { backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  meta: { fontSize: 14, fontWeight: '800', color: palette.text, lineHeight: 21 },
  metaSub: { fontSize: 12, fontWeight: '600', color: palette.textFaint, marginTop: 2, marginBottom: 6 },
  caption: {
    minHeight: 72,
    borderRadius: 12,
    backgroundColor: palette.bgSoft,
    padding: 12,
    fontSize: 14,
    color: palette.text,
    textAlignVertical: 'top',
  },
  counter: { fontSize: 11.5, color: palette.textFaint, textAlign: 'right', marginTop: 4 },
  pickLabel: { fontSize: 13, fontWeight: '800', color: palette.textMuted, marginTop: 4 },
  note: { flexDirection: 'row', gap: 8, backgroundColor: palette.blueSoft, borderRadius: 12, padding: 12 },
  noteText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: palette.blueDeep, lineHeight: 19 },
  hint: { fontSize: 12.5, color: palette.textFaint },
  error: { fontSize: 13, fontWeight: '700', color: palette.danger },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    padding: 14,
  },
  optionOn: { borderColor: palette.blue, backgroundColor: palette.blueSoft },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconOn: { backgroundColor: '#FFFFFF' },
  optionTitle: { fontSize: 14.5, fontWeight: '800', color: palette.text },
  optionTitleOn: { color: palette.blueDeep },
  optionSub: { fontSize: 12, color: palette.textFaint, marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: palette.checkOff, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: palette.blue },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.blue },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: palette.borderSoft },
  primary: { height: 52, borderRadius: 14, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  primaryOff: { backgroundColor: '#C9D3DF' },
  primaryText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  ghost: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 15, fontWeight: '800', color: palette.textDim },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneTitle: { fontSize: 22, fontWeight: '900', color: palette.text },
  doneSub: { fontSize: 14, color: palette.textDim, textAlign: 'center', lineHeight: 22 },
  doneBtn: { alignSelf: 'stretch', marginTop: 8 },
});
