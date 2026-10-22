import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { BlueSwitch } from '@/components/ui/list-rows';
import { MASCOT as MASCOTS } from '@/components/ui/mascot';
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
 * SOMA-748(h9wxCz·bu9BAX·oiXiqF): 큰 썸네일 줄, 「나만 보기」·「공개」 선택지(체크 동그라미), 완료는 pen 10-11 「비공개로 저장했어요」 모양(가운데 액티+체크, 안내 알약).
 * 디자인은 「나만 보기」를 기본으로 골라 두지만 정본(challenge/entry)이 "미리 선택 없음"이라 고르기 전까지 비워 둔다.
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
  const [durationMs, setDurationMs] = useState<number | null>(null);
  /** 넘겨받은 영상의 출처 — 보관함(videoId)·갤러리·방금 촬영. 머리줄 문구가 출처를 따른다(SOMA-773). */
  const [fromGallery, setFromGallery] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [caption, setCaption] = useState('');
  // pen 챌린지 올리기(SOMA-748) — 「나만 보기」가 먼저 골라져 있다. 공개는 배우가 직접 바꾼다.
  const [visibility, setVisibility] = useState<EntryVisibility | null>('private');
  /** 얼굴 모자이크(SOMA-809) — 공개를 고르면 보이는 켜기 버튼. 기본 꺼짐이고 공개일 때만 요청에 실린다. */
  const [faceMosaic, setFaceMosaic] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 방금 만든 참여작 — 있으면 완료 화면이다. */
  const [created, setCreated] = useState<{ id: string; visibility: EntryVisibility; faceMosaic: boolean } | null>(null);
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
    setFromGallery(recorded.source === 'gallery');
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
      const body = buildEntryBody({ requestId: 'pending', videoId, caption, visibility, faceMosaic });
      const attempt = entryAttemptFor(attemptRef.current, entryFingerprint(body), () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      attemptRef.current = attempt;
      const entry = await api.createEntry(challengeId, { ...body, request_id: attempt.requestId });
      logEvent('challenge_entry_created', { visibility });
      void markFirstChallengeFinished();
      setCreated({ id: entry.id, visibility, faceMosaic: body.face_mosaic === true });
    } catch (e) {
      const failure = entryFailure(e);
      void logEvent(CHALLENGE_FUNNEL_EVENTS.submitFailed, submitFailedParams(failure));
      if (failure.kind === 'fingerprint_mismatch') attemptRef.current = null;
      setError(entryFailureMessage(failure));
    } finally {
      lockRef.current = false;
      setSubmitting(false);
    }
  }, [caption, challengeId, faceMosaic, pendingId, submitting, user?.id, videoId, visibility]);

  if (created) {
    const copy = doneCopy(created.visibility);
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        {/* pen 10-11 「비공개로 저장했어요」 — 가운데 손 흔드는 액티 + 파란 체크, 제목 · 안내, 아래 「홈으로 가기」 버튼 하나(SOMA-820, AI 리포트 없앰). */}
        <View style={styles.doneWrap}>
          <View style={styles.doneHero}>
            <Image source={MASCOTS.cheer} style={styles.doneMascot} contentFit="contain" accessibilityIgnoresInvertColors />
            <View style={styles.doneBadgeRing}>
              <View style={styles.doneBadge}>
                <Feather name="check" size={16} color={palette.onAccent} />
              </View>
            </View>
          </View>
          <Text style={[styles.doneTitle, styles.doneGap18]}>{copy.title}</Text>
          <Text style={[styles.doneSub, styles.doneGap8]}>
            {created.faceMosaic ? t('challengeUpload.doneSubMosaic') : copy.body}
          </Text>
        </View>
        <View style={styles.doneFooter}>
          <PrimaryButton label={t('challengeUpload.goHome')} onPress={() => router.replace('/')} />
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
                t(params.videoId ? 'challengeUpload.fromLibrary' : fromGallery ? 'challengeUpload.fromGallery' : 'challengeUpload.justRecorded'),
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

        {/* 공개를 고르면 표본 활용을 한 줄로 알린다. */}
        {visibility === 'public' && (
          <View style={styles.note}>
            <Feather name="zap" size={13} color={palette.blueDeep} />
            <Text style={styles.noteText}>{t('challengeUpload.note')}</Text>
          </View>
        )}

        {/* 공개를 고르면 얼굴 모자이크를 켤 수 있다(SOMA-809). 켜면 다른 사람에게는 얼굴을 가린 사본만 간다. */}
        {visibility === 'public' && (
          <View style={styles.mosaicRow}>
            <View style={styles.flex}>
              <Text style={styles.mosaicTitle}>{t('challengeUpload.mosaicTitle')}</Text>
              <Text style={styles.optionSub}>{t('challengeUpload.mosaicSub')}</Text>
            </View>
            <BlueSwitch
              value={faceMosaic}
              onValueChange={setFaceMosaic}
              accessibilityLabel={t('challengeUpload.mosaicTitle')}
            />
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

      <CtaBar safeBottom={false}>
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
      </CtaBar>
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
  meta: { fontSize: 15, fontWeight: '800', color: palette.text, lineHeight: 23 },
  metaSub: { fontSize: 13, fontWeight: '600', color: palette.textFaint, lineHeight: 20 },
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
  // pen h9wxCz — 안 고른 줄은 안쪽 [15,4], 고른 줄은 [15,16] + 연파랑 바탕.
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 4 },
  optionOn: { backgroundColor: palette.blueSoft, paddingHorizontal: 16 },
  optionTitle: { fontSize: 17, fontWeight: '700', color: palette.text, lineHeight: 26 },
  optionTitleOn: { color: palette.blueDeep },
  optionSub: { fontSize: 13, fontWeight: '500', color: palette.textFaint, lineHeight: 20 },
  mosaicRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, paddingHorizontal: 4 },
  mosaicTitle: { fontSize: 15, fontWeight: '700', color: palette.text, lineHeight: 22 },
  // 본문 가운데 — 안쪽 [0,25,40,25]. 액티 84×88(체크 28 · 흰 테두리 3, 왼쪽 54 · 위 57) · 18 · 제목 · 8 · 안내 · 14 · 알약.
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 25, paddingBottom: 40 },
  doneHero: { width: 84, height: 88 },
  doneMascot: { width: 84, height: 88 },
  doneBadgeRing: { position: 'absolute', left: 51, top: 54, padding: 3, borderRadius: 17, backgroundColor: palette.bg },
  doneBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 22, fontWeight: '800', lineHeight: 28, color: palette.text, textAlign: 'center' },
  doneSub: { fontSize: 15, fontWeight: '500', lineHeight: 23, color: palette.textMuted, textAlign: 'center' },
  doneGap18: { marginTop: 18 },
  doneGap8: { marginTop: 8 },
  doneFooter: { gap: 10, paddingHorizontal: 20, paddingBottom: 11 },
});
