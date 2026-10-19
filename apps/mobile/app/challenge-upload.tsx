import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
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
  videoTooShort,
  type EntryAttempt,
} from '@/lib/challenge/entry';
import {
  CHALLENGE_FUNNEL_EVENTS,
  submitFailedParams,
  uploadExitParams,
  uploadFailedParams,
  uploadParams,
  visibilityParams,
} from '@/lib/challenge/funnel';
import { hasFinishedFirstChallenge, markFirstChallengeFinished } from '@/lib/challenge/intro-state';
import { CAPTION_MAX, type ChallengeDetail, type EntryVisibility } from '@/lib/challenge/types';
import { formatClipDuration } from '@/lib/archive-format';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import { confirmedVideoFor, flushLibraryUploads, localCopyFor, onLibraryChange, saveRecordingToLibrary } from '@/lib/library/library-runner';
import { takeRecordedVideo } from '@/lib/recorded-video';
import { limitVideoBuffer, sourceWhileFocused } from '@/lib/video-memory';

/**
 * A18.1·A18.2 올리기 → A18.3 완료(challenge.entry).
 *
 * 영상은 보관함의 확정된 영상(video_id)이거나 방금 찍은 것이다 — 찍은 것은 보관함 큐가 확정한
 * 뒤에 올린다(영상은 연습과 같은 videos 를 쓴다). 공개 범위는 여기서 **명시적으로** 고르고,
 * 공개를 고르면 다른 참여자의 AI 리포트 비교에 쓰일 수 있다는 것을 한 줄 알린다. 같은 시도의
 * 재전송은 같은 요청 id 라 참여작은 하나다. 완료 문구는 공개와 비공개가 다르다.
 *
 * SOMA-748(h9wxCz·bu9BAX·oiXiqF): 큰 썸네일 줄, 「나만 보기」·「공개」 선택지(체크 동그라미), 완료는 마스코트 줄 + 파란 안내.
 * 디자인은 「나만 보기」를 기본으로 골라 두지만 정본(challenge/entry)이 "미리 선택 없음"이라 고르기 전까지 비워 둔다.
 */
const MASCOT = require('@/assets/images/mascot-home.png');
export default function ChallengeUploadScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ challengeId?: string; videoId?: string; line?: string; work?: string }>();
  const challengeId = params.challengeId ?? null;

  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [videoId, setVideoId] = useState<string | null>(params.videoId ?? null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<EntryVisibility | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 방금 만든 참여작 — 있으면 완료 화면이고, "AI 리포트 받기"가 id 를 쓴다. */
  const [created, setCreated] = useState<{ id: string; visibility: EntryVisibility } | null>(null);
  const attemptRef = useRef<EntryAttempt | null>(null);
  const lockRef = useRef(false);

  // 제출 없이 떠나면 어디까지 왔는지 남긴다(SOMA-698). 마지막 상태를 ref 에 두고 화면이 정리될 때 보낸다.
  const exitRef = useRef({
    openedAt: Date.now(),
    hasVideo: false,
    uploading: false,
    visibility: null as EntryVisibility | null,
    created: false,
  });
  useEffect(() => {
    exitRef.current = {
      ...exitRef.current,
      hasVideo: Boolean(videoId || pendingId),
      uploading: Boolean(pendingId && !videoId),
      visibility,
      created: Boolean(created),
    };
  });
  useEffect(
    () => () => {
      const last = exitRef.current;
      if (last.created) return;
      void logEvent(CHALLENGE_FUNNEL_EVENTS.uploadExit, uploadExitParams({ ...last, now: Date.now() }));
    },
    [],
  );

  const focused = useIsFocused();
  const player = useVideoPlayer(sourceWhileFocused(localUri, focused), (p) => {
    p.loop = true;
    limitVideoBuffer(p);
    p.muted = true;
    p.play();
  });

  // 방금 찍은 영상은 보관함에 저장해 확정되기를 기다린다(영상은 보관함에 남는다).
  useEffect(() => {
    const recorded = takeRecordedVideo();
    if (!recorded || !user?.id || params.videoId) return;
    setLocalUri(recorded.uri);
    setDurationMs(recorded.durationMs ?? null);
    if (videoTooLong(recorded.durationMs)) {
      void logEvent(CHALLENGE_FUNNEL_EVENTS.uploadFailed, uploadFailedParams('video_too_long'));
      setError(t('challengeUpload.errTooLong'));
      return;
    }
    if (videoTooShort(recorded.durationMs)) {
      setError(t('challengeUpload.errTooShort'));
      return;
    }
    void logEvent(CHALLENGE_FUNNEL_EVENTS.uploadStarted, uploadParams('new'));
    void saveRecordingToLibrary({ uri: recorded.uri, durationMs: recorded.durationMs, owner: user.id }).then((outcome) => {
      if (outcome.kind === 'queued') {
        setPendingId(outcome.entry.id);
        return;
      }
      void logEvent(CHALLENGE_FUNNEL_EVENTS.uploadFailed, uploadFailedParams(outcome.code));
      setError(t('challengeUpload.errTooLong'));
    });
  }, [params.videoId, user?.id]);

  // 대기 중이던 촬영본이 확정되면 그 영상 id 로 올린다.
  useEffect(() => {
    if (!pendingId || videoId) return;
    const check = () => {
      const confirmed = confirmedVideoFor(pendingId);
      if (!confirmed) return;
      void logEvent(CHALLENGE_FUNNEL_EVENTS.uploadSucceeded, uploadParams('new'));
      setVideoId(confirmed);
    };
    check();
    return onLibraryChange(check);
  }, [pendingId, videoId]);

  // 보관함에서 고른 영상은 이미 올라가 있다 — 업로드 단계를 통과한 것으로 센다(SOMA-616).
  useEffect(() => {
    if (params.videoId) void logEvent(CHALLENGE_FUNNEL_EVENTS.uploadSucceeded, uploadParams('library'));
  }, [params.videoId]);

  // 보관함에서 고른 영상은 기기 복사본이 있으면 미리보기로 쓴다.
  useEffect(() => {
    if (!params.videoId) return;
    void localCopyFor(params.videoId).then((uri) => uri && setLocalUri(uri));
  }, [params.videoId]);

  useEffect(() => {
    void hasFinishedFirstChallenge().then((done) => setShowGuide(!done));
  }, []);

  useEffect(() => {
    if (!challengeId) return;
    void api
      .getChallenge(challengeId)
      .then(setChallenge)
      .catch(() => setError(t('challenges.notFound')));
  }, [challengeId]);

  const chooseVisibility = (next: EntryVisibility) => {
    if (next !== visibility) void logEvent(CHALLENGE_FUNNEL_EVENTS.visibilitySelected, visibilityParams(next));
    setVisibility(next);
  };

  const submit = useCallback(async () => {
    if (!challengeId || lockRef.current || submitting) return;
    if (!visibility) return;
    if (!videoId) {
      // 아직 올리는 중이면 한 번 밀어 보고 안내한다.
      if (pendingId && user?.id) await flushLibraryUploads(user.id);
      const confirmed = pendingId ? confirmedVideoFor(pendingId) : null;
      if (!confirmed) {
        void logEvent(CHALLENGE_FUNNEL_EVENTS.uploadFailed, uploadFailedParams('still_uploading'));
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
      logEvent('challenge_entry_created', { visibility });
      void markFirstChallengeFinished();
      setCreated({ id: entry.id, visibility });
    } catch (e) {
      const failure = entryFailure(e);
      void logEvent(CHALLENGE_FUNNEL_EVENTS.submitFailed, submitFailedParams(failure));
      if (failure.kind === 'fingerprint_mismatch') attemptRef.current = null;
      setError(entryFailureMessage(failure));
    } finally {
      lockRef.current = false;
      setSubmitting(false);
    }
  }, [caption, challengeId, pendingId, submitting, user?.id, videoId, visibility]);

  if (created) {
    const copy = doneCopy(created.visibility);
    /**
     * "AI 리포트 받기"(A18.3) — 같은 대사의 다른 참여작과 견주는 챌린지 리포트로 간다.
     * 공개·비공개 참여작 모두 요청할 수 있다(challenge.ai-report).
     */
    const getReport = () => {
      logEvent('challenge_upload_report', { visibility: created.visibility });
      router.replace({
        pathname: '/ai-report',
        params: { entryId: created.id, videoId: videoId ?? '', challengeId: challengeId ?? '', visibility: created.visibility },
      });
    };
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.doneWrap}>
          <View style={styles.doneIcon}>
            <Feather name="check" size={30} color={palette.blue} />
          </View>
          <View style={styles.doneTitleRow}>
            <Image source={MASCOT} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
            <Text style={styles.doneTitle}>{copy.title}</Text>
          </View>
          <Text style={styles.doneSub}>
            {copy.body} {t('challengeUpload.doneGuide')}
          </Text>
          <PrimaryButton
            style={styles.doneBtn}
            label={t('challengeUpload.goHome')}
            onPress={() =>
              challengeId
                ? router.replace({ pathname: '/challenge-detail', params: { id: challengeId } })
                : router.replace('/')
            }
          />
          <SecondaryButton style={[styles.doneBtn, styles.ghost]} label={t('challengeUpload.getReport')} onPress={getReport} />
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
                <Feather name="video" size={20} color={palette.textFaint} />
              </View>
            )}
          </View>
          <View style={styles.headText}>
            <Text style={styles.meta} numberOfLines={2}>
              {challenge ? `“${challenge.line}”` : (params.line ?? '')}
            </Text>
            <Text style={styles.metaSub}>
              {[
                t(params.videoId ? 'challengeUpload.fromLibrary' : 'challengeUpload.justRecorded'),
                durationMs ? formatClipDuration(Math.round(durationMs / 1000)) : '',
                challenge ? dDayLabel(challenge) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>

        <Text style={styles.pickLabel}>{t('challengeUpload.pickVisibility')}</Text>
        {showGuide && <Text style={styles.guide}>{t('challengeUpload.guide')}</Text>}
        <Option
          title={t('challengeUpload.optPrivate')}
          sub={t('challengeUpload.optPrivateSub')}
          selected={visibility === 'private'}
          onPress={() => chooseVisibility('private')}
        />
        <Option
          title={t('challengeUpload.optPublic')}
          sub={t('challengeUpload.optPublicSub')}
          selected={visibility === 'public'}
          onPress={() => chooseVisibility('public')}
        />

        {/* 공개를 고르면 표본 활용을 한 줄로 알린다(challenge.ai-report). */}
        {visibility === 'public' && (
          <View style={styles.note}>
            <Feather name="zap" size={13} color={palette.blueDeep} />
            <Text style={styles.noteText}>{t('challengeUpload.note')}</Text>
          </View>
        )}

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

        {uploading && <Text style={styles.hint}>{t('challengeUpload.waitingVideo')}</Text>}
        {captionTooLong(caption) && <Text style={styles.error}>{t('challengeUpload.errInvalid')}</Text>}
        {ended && <Text style={styles.error}>{t('challengeUpload.errClosed')}</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </KeyboardAwareScroll>

      <View style={styles.footer}>
        <PrimaryButton
          label={t(
            visibility === 'private'
              ? 'challengeUpload.submitPrivate'
              : visibility === 'public'
                ? 'challengeUpload.submit'
                : 'challengeUpload.submitNone',
          )}
          onPress={() => void submit()}
          disabled={!ready || ended}
          loading={submitting}
        />
      </View>
    </SafeAreaView>
  );
}

/** 선택지 줄(h9wxCz) — 고르면 연파랑 바탕·파란 글자·체크 동그라미, 안 고르면 빈 동그라미. */
function Option({
  title,
  sub,
  selected,
  onPress,
}: {
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
      accessibilityLabel={title}
      accessibilityState={{ selected }}>
      <View style={styles.flex}>
        <Text style={[styles.optionTitle, selected && styles.optionTitleOn]}>{title}</Text>
        <Text style={styles.optionSub}>{sub}</Text>
      </View>
      <Feather name={selected ? 'check-circle' : 'circle'} size={22} color={selected ? palette.blue : palette.checkOff} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1, gap: 6 },
  content: { paddingHorizontal: 24, paddingTop: 16, gap: 14, paddingBottom: 24 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbWrap: { width: 100, height: 140, borderRadius: 14, overflow: 'hidden', backgroundColor: palette.textDim },
  thumb: { width: '100%', height: '100%' },
  thumbEmpty: { backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, minWidth: 0, gap: 6 },
  meta: { fontSize: 15, fontWeight: '800', color: palette.text, lineHeight: 22 },
  metaSub: { fontSize: 13, fontWeight: '600', color: palette.textFaint },
  caption: {
    minHeight: 72,
    borderRadius: 12,
    backgroundColor: palette.bgSoft,
    padding: 12,
    fontSize: 14,
    color: palette.text,
    textAlignVertical: 'top',
    marginTop: 4,
  },
  counter: { fontSize: 11.5, color: palette.textFaint, textAlign: 'right', marginTop: -8 },
  pickLabel: { fontSize: 14, fontWeight: '800', color: palette.textDim, marginTop: 4 },
  guide: { fontSize: 14, fontWeight: '700', color: palette.blueDeep, lineHeight: 21 },
  note: { flexDirection: 'row', gap: 8, backgroundColor: palette.blueSoft, borderRadius: 12, padding: 12 },
  noteText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: palette.blueDeep, lineHeight: 19 },
  hint: { fontSize: 12.5, color: palette.textFaint },
  error: { fontSize: 13, fontWeight: '700', color: palette.danger },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 16 },
  optionOn: { backgroundColor: palette.blueSoft },
  optionTitle: { fontSize: 17, fontWeight: '700', color: palette.text },
  optionTitleOn: { color: palette.blueDeep },
  optionSub: { fontSize: 13, fontWeight: '500', color: palette.textFaint },
  footer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 10 },
  ghost: { backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch' },
  mascot: { width: 52, height: 58 },
  doneTitle: { flex: 1, fontSize: 22, fontWeight: '900', color: palette.text },
  doneSub: { alignSelf: 'stretch', fontSize: 14, fontWeight: '700', color: palette.blueDeep, lineHeight: 22 },
  doneBtn: { alignSelf: 'stretch', marginTop: 8 },
});
