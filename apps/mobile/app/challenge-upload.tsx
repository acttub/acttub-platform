import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { useEntryShare } from '@/components/entry-share-sheet';
import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { setPickedVideo } from '@/lib/practice/picked-video';
import { ChallengeDone } from '@/components/challenge-done';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { Checkbox } from '@/components/ui/checkbox';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { BlueSwitch } from '@/components/ui/list-rows';
import { TextField } from '@/components/ui/text-field';
import { KeyboardLift } from '@/components/keyboard-lift';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { dDayLabel, isEnded } from '@/lib/challenge/browse';
import {
  buildEntryBody,
  canSubmitEntry,
  captionTooLong,
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
import { useAuth } from '@/lib/auth';
import { resultDay } from '@/lib/challenge/week-result';
import { translate as t, translateList } from '@/lib/i18n';
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
  const scrollRef = useRef<ScrollView>(null);
  const [videoId, setVideoId] = useState<string | null>(params.videoId ?? null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
    const [caption, setCaption] = useState('');
  // pen C9.16·C9.17 — 「공개」가 위에 있고 먼저 골라져 있다.
  const [visibility, setVisibility] = useState<EntryVisibility | null>('public');
  /** 얼굴 모자이크(SOMA-809) — 공개를 고르면 보이는 켜기 버튼. 기본 꺼짐이고 공개일 때만 요청에 실린다. */
  const [faceMosaic, setFaceMosaic] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 방금 만든 참여작 — 있으면 완료 화면이다. */
  const [created, setCreated] = useState<{ id: string; visibility: EntryVisibility; faceMosaic: boolean; first: boolean } | null>(null);
  const { alert, dialog } = useAppDialog();
  const entryShare = useEntryShare(params.line ?? '', () => void alert({ title: t('entryShare.title'), message: t('entryShare.none') }));
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
      const first = !(await hasFinishedFirstChallenge());
      void markFirstChallengeFinished();
      setCreated({ id: entry.id, visibility, faceMosaic: body.face_mosaic === true, first });
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

  // 올리기를 마친 뒤 뒤로 가면 촬영 화면으로 돌아갔다(10/28 폰 확인). 완료 화면에서 뒤로는 챌린지(없으면 홈)로 간다.
  useEffect(() => {
    if (!created) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (challengeId) router.dismissTo({ pathname: '/challenge-detail', params: { id: challengeId } });
      else router.dismissTo('/');
      return true;
    });
    return () => sub.remove();
  }, [created, challengeId, router]);

  if (created) {
    const day = challenge ? resultDay(challenge.ends_at) : null;
    const date = day
      ? t('challengeDone.date', { month: day.month, day: day.day, weekday: translateList('challengeDone.weekdays')[day.weekday] ?? '' })
      : null;
    const isPublic = created.visibility === 'public';
    const line = challenge?.line ?? params.line ?? '';
    const parts = [
      line ? `“${line}”` : '',
      created.first ? t(isPublic ? 'challengeDone.visPublic' : 'challengeUpload.optPrivate') : '',
      isPublic ? (date ? t('challengeDone.resultAt', { date }) : '') : created.first ? '' : t('challengeDone.onlyMe'),
      created.faceMosaic ? t('challengeUpload.doneSubMosaic') : '',
    ].filter(Boolean);
    const share = () => {
      void logEvent('challenge_upload_share', { visibility: created.visibility });
      void entryShare.openById(created.id);
    };
    // 코칭은 기존 올리기(/upload) 흐름으로 이어진다 — 방금 올린 챌린지 영상을 새 연습의 영상으로 미리 골라 둔다.
    const coachWithThis = () => {
      if (videoId) setPickedVideo({ videoId, pendingId: null, uri: localUri, playbackUrl: null, durationMs: null });
      router.push('/upload');
    };
    return (
      <>
        {/* iOS 밀어서 뒤로도 촬영 화면으로 가지 않게 막는다 — 완료 화면의 버튼으로 나간다. */}
        <Stack.Screen options={{ gestureEnabled: false }} />
        <ChallengeDone
          title={created.first ? t('challengeDone.titleFirst') : t(isPublic ? 'challengeDone.titlePublic' : 'challengeDone.titlePrivate')}
          sub={parts.join(' · ')}
          rows={[
            ...(isPublic ? [{ key: 'share', icon: 'share-2' as const, title: t('challengeDone.share'), sub: t('challengeDone.shareSub'), onPress: share }] : []),
            { key: 'coach', icon: 'video' as const, title: t('challengeDone.coach'), sub: t('challengeDone.coachSub'), onPress: coachWithThis },
            ...(challengeId
              ? [
                  {
                    key: 'others',
                    icon: 'play' as const,
                    title: t('challengeDone.others'),
                    sub: t('challengeDone.othersSub'),
                    onPress: () => router.replace({ pathname: '/challenge-play', params: { id: challengeId } }),
                  },
                ]
              : []),
          ]}
          onHome={() => router.dismissTo('/')}
        />
        {entryShare.sheet}
        {dialog}
      </>
    );
  }

  const uploading = Boolean(pendingId && !videoId);
  const ready = canSubmitEntry({ videoId, visibility, caption }) && !uploading;
  const ended = challenge ? isEnded(challenge) : false;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('challengeUpload.title') }} />
      {/* 키보드가 뜨면 키보드 높이만큼 아래를 비워 캡션 칸과 「올리기」가 키보드 위에 남게 한다(iOS·안드로이드 같은 방식).
          예전엔 iOS를 스크롤 자동 인셋에 맡겨 「올리기」가 키보드 뒤에 숨었다. 캡션을 누르면 맨 아래까지 내려 칸이 보이게 한다. */}
      <KeyboardLift style={styles.body} aboveSafeBottom>
      <KeyboardAwareScroll ref={scrollRef} contentContainerStyle={styles.content}>
        <View style={styles.videoRow}>
          <View style={styles.thumbWrap}>
            {localUri ? (
              <VideoView style={styles.thumb} player={player} contentFit="cover" nativeControls={false} />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <Feather name="video" size={20} color={palette.iconFaint} />
              </View>
            )}
          </View>
          <View style={styles.videoText}>
            {!!challenge?.line && (
              <Text style={styles.videoLine} numberOfLines={4}>
                “{challenge.line}”
              </Text>
            )}
            {!!challenge && <Text style={[styles.videoSub, ended && styles.videoSubEnded]}>{dDayLabel(challenge)}</Text>}
          </View>
        </View>
        <Text style={styles.rangeLabel}>{t('challengeUpload.pickVisibility')}</Text>

        <Option
          title={t('challengeUpload.optPublic')}
          sub={t('challengeUpload.optPublicSub')}
          selected={visibility === 'public'}
          onPress={() => chooseVisibility('public')}
        />
        <Option
          title={t('challengeUpload.optPrivate')}
          sub={t('challengeUpload.optPrivateSub')}
          selected={visibility === 'private'}
          onPress={() => chooseVisibility('private')}
        />

        {/* 공개를 고르면 얼굴 모자이크를 켤 수 있다(SOMA-809). 켜면 다른 사람에게는 얼굴을 가린 사본만 간다. */}
        {visibility === 'public' && (
          <View style={styles.mosaicRow}>
            <View style={styles.flex}>
              <Text style={styles.mosaicTitle}>{t('challengeUpload.mosaicTitle')}</Text>
              <Text style={styles.optionSub}>{t('challengeUpload.mosaicSub')}</Text>
            </View>
            <BlueSwitch value={faceMosaic} onValueChange={setFaceMosaic} accessibilityLabel={t('challengeUpload.mosaicTitle')} />
          </View>
        )}

        <TextField
          style={styles.caption}
          placeholder={t('challengeUpload.captionPh')}
          accessibilityLabel={t('challengeUpload.captionPh')}
          value={caption}
          onChangeText={setCaption}
          onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250)}
          maxLength={CAPTION_MAX}
          multiline
        />
        <Text style={styles.counter}>{t('challengeUpload.captionCounter', { count: [...caption].length, max: CAPTION_MAX })}</Text>

        {uploading && <Text style={styles.hint}>{t('challengeUpload.waitingVideo')}</Text>}
        {captionTooLong(caption) && <InlineErrorLine message={t('challengeUpload.errInvalid')} />}
        {ended && <InlineErrorLine message={t('challengeUpload.errClosed')} />}
        {!!error && <InlineErrorLine message={error} />}
      </KeyboardAwareScroll>

      <CtaBar safeBottom={false}>
        {/* 챌린지를 못 찾았거나 끝났으면 올릴 곳이 없어 꺼 둔다. */}
        <PrimaryButton
          label={t('challengeUpload.submit')}
          onPress={() => void submit()}
          disabled={!ready || ended || !challenge}
          loading={submitting}
          loadingLabel={t('challengeUpload.submitting')}
        />
      </CtaBar>
      </KeyboardLift>
    </SafeAreaView>
  );
}

/** 선택지 줄(pen C9.17) — 고르면 연파랑 바탕·파란 테두리·파란 글자·오른쪽 체크, 안 고르면 흰 바탕 · 회색 테두리. */
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
      {selected && <Checkbox checked />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { flex: 1 },
  flex: { flex: 1, gap: space[1] },
  content: { paddingHorizontal: space.gutter, paddingTop: space[2], gap: space[3], paddingBottom: space[4] },
  videoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  videoText: { flex: 1, minWidth: 0, gap: space[1.5] },
  videoLine: { ...type.body1Bold, color: palette.text },
  videoSub: { ...type.caption, color: palette.textMeta },
  videoSubEnded: { color: palette.danger },
  rangeLabel: { ...type.body2Bold, color: palette.textSub, marginTop: space[2] },
  thumbWrap: { width: 72, height: 100, borderRadius: radius.md, overflow: 'hidden', backgroundColor: palette.textSub },
  thumb: { width: '100%', height: '100%' },
  thumbEmpty: { backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  caption: { minHeight: 96, paddingTop: space[3], textAlignVertical: 'top', marginTop: space[1] },
  counter: { ...type.caption, color: palette.textMeta, textAlign: 'right', marginTop: -space[1] },
  hint: { ...type.caption, color: palette.textMeta },
  option: { flexDirection: 'row', alignItems: 'center', gap: space[3], borderRadius: radius.lg, paddingVertical: space[3], paddingHorizontal: space[4], borderWidth: 1, borderColor: palette.border },
  optionOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue, borderWidth: 1.5, paddingHorizontal: space[4] - 0.5, paddingVertical: space[3] - 0.5 },
  optionTitle: { ...type.headline, fontWeight: '700', color: palette.text },
  optionTitleOn: { color: palette.blueDeep },
  optionSub: { ...type.caption, color: palette.textMeta },
  mosaicRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[1] },
  mosaicTitle: { ...type.body1Bold, color: palette.text },
});
