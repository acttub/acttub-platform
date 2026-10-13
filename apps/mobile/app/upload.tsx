import * as ImagePicker from 'expo-image-picker';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { Stepper } from '@/components/practice-chrome';
import { VideoSourceSheet } from '@/components/video-source-sheet';
import { palette } from '@/constants/palette';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { useVideoPreviewEvents } from '@/hooks/use-video-preview-events';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import {
  confirmedVideoFor,
  flushLibraryUploads,
  localCopyFor,
  onLibraryChange,
  saveRecordingToLibrary,
} from '@/lib/library/library-runner';
import { videoErrorMessage } from '@/lib/library/video-checks';
import { peekPickedVideo, takePickedVideo, type PickedVideo } from '@/lib/practice/picked-video';
import { canStart, continueVideoId, planFor, type StartPlan } from '@/lib/practice/resume';
import {
  BLOCKAGE_NOTE_MAX,
  blockageNoteOverflow,
  buildContinueBody,
  buildStartBody,
  emptyBlockageDraft,
  fingerprintOf,
  inProgressPracticeId,
  PRACTICE_TITLE_MAX,
  sceneOverflow,
  startFailure,
  titleOverflow,
  type BlockageDraft,
  type SceneDraft,
} from '@/lib/practice/start';
import { takeContinueOrigin } from '@/lib/practice/session-state';
import {
  PRACTICE_UPLOAD_EVENTS,
  rightsToggleParams,
  startBlockReason,
  startBlockedParams,
  uploadExitParams,
  videoPickedParams,
  videoReadyParams,
  type PickSource,
} from '@/lib/practice/upload-events';
import type { BlockageCategory } from '@/lib/practice/types';
import { attemptFor, newRequestId, type RequestAttempt } from '@/lib/request-id';
import { TARGET } from '@/lib/spotlight-targets';
import { sampleVideoUri } from '@/lib/tutorial-loop';
import { SAMPLE_PRACTICE_ID, sampleScene } from '@/lib/tutorial-sample';
import { normalizeVideoDurationMs } from '@/lib/upload-input';
import { limitVideoBuffer, sourceWhileFocused } from '@/lib/video-memory';

/**
 * A8·A8.1·A9.x 새 연습 준비(practice.start · practice.resume).
 *
 * 영상은 보관함에서 고르거나 새로 찍는다 — 여기서 올리지 않는다(올리기는 보관함 큐가 한다).
 * 도움 갈래와 상세 설명은 선택이고, 시작을 누르면 회차 하나와 분석 작업 하나가 생긴다. 상황·인물·목표 칸과
 * 「이전 연습 이어서 하기」, 세부 칩은 SOMA-656 에서 뺐다 — 이어서 연습(연습 상세)으로 들어오면 지난 장면은 화면 없이
 * 그대로 보내고, 세부는 비워 보내 서버 기본값(그 외)이 된다.
 * 같은 시도의 재전송은 같은 요청 id 라 회차는 하나다. 묶음에 진행 중 회차가 있으면(409) 그
 * 회차로 돌려보낸다. 이론 선택은 0.1.0에서 뺐다.
 */
const CATEGORIES: BlockageCategory[] = ['분석', '표현', '그 외'];
export default function UploadScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { alert, dialog } = useAppDialog();
  const keyboardHeight = useKeyboardHeight();
  const keyboardVisible = keyboardHeight > 0;

  // 튜토리얼의 예시(SOMA-494) — 예시 영상과 장면을 채워 두고, 시작하면 서버 없이 예시 회차로 간다.
  const sample = useLocalSearchParams<{ sample?: string }>().sample === '1';
  const [plan] = useState<StartPlan>(() => planFor(sample ? null : takeContinueOrigin()));
  const [picked, setPicked] = useState<PickedVideo | null>(() =>
    sample
      ? { videoId: null, pendingId: null, uri: sampleVideoUri(), playbackUrl: null, durationMs: null }
      : peekPickedVideo(),
  );
  const [scene] = useState<SceneDraft>(() => (sample ? sampleScene() : plan.scene));
  const [blockage, setBlockage] = useState<BlockageDraft>(emptyBlockageDraft);
  // 묶음 제목(SOMA-671). 이어하기는 원래 묶음 제목을 그대로 쓰므로 새 연습에서만 받는다.
  const [title, setTitle] = useState('');
  const [agreedRights, setAgreedRights] = useState(sample);
  const pickTarget = useSpotlightTarget(TARGET.uploadPick);
  const sampleTarget = useSpotlightTarget(TARGET.uploadSample);
  const sceneTarget = useSpotlightTarget(TARGET.uploadScene);
  const startTarget = useSpotlightTarget(TARGET.uploadStart);
  const tutorialGuide = useTutorialSpotlight('upload');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef<RequestAttempt | null>(null);
  const startLockRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  // 어디서 멈추는지 세는 계측(SOMA-698, lib/practice/upload-events). 예시(튜토리얼) 화면은 세지 않는다.
  const sourceRef = useRef<PickSource | null>(plan.video.kind === 'same' ? 'same' : null);
  const pendingSinceRef = useRef<number | null>(null);
  const blockedTapsRef = useRef(0);
  const startedRef = useRef(false);
  const exitRef = useRef({ openedAt: Date.now(), hasVideo: false, uploading: false, rights: false });
  const notePicked = useCallback(
    (source: PickSource, video: PickedVideo) => {
      if (sample) return;
      const needsUpload = Boolean(video.pendingId && !video.videoId);
      sourceRef.current = source;
      pendingSinceRef.current = needsUpload ? Date.now() : null;
      void logEvent(PRACTICE_UPLOAD_EVENTS.videoPicked, videoPickedParams(source, needsUpload, video.durationMs));
    },
    [sample],
  );
  const noteReady = useCallback(() => {
    if (sample || pendingSinceRef.current === null) return;
    void logEvent(
      PRACTICE_UPLOAD_EVENTS.videoReady,
      videoReadyParams(sourceRef.current ?? 'library', Date.now() - pendingSinceRef.current),
    );
    pendingSinceRef.current = null;
  }, [sample]);

  const previewUri = picked?.uri ?? picked?.playbackUrl ?? null;
  const focused = useIsFocused();
  const player = useVideoPlayer(sourceWhileFocused(previewUri, focused), (p) => {
    p.loop = false;
    limitVideoBuffer(p);
  });
  // 올린 영상을 사용자가 미리보기에서 실제로 틀어 보는지 센다.
  useVideoPreviewEvents(player, 'upload', previewUri, { sample, continued: plan.video.kind === 'same' });

  // 보관함·촬영·갤러리에서 돌아오면 고른 영상을 받는다.
  useFocusEffect(
    useCallback(() => {
      const next = takePickedVideo();
      if (next) {
        setPicked(next);
        setError(null);
        notePicked(next.source ?? 'library', next);
      }
    }, [notePicked]),
  );

  // 보관함 목록은 재생 주소를 주지 않는다(상세에서만 준다) — 목록에서 고른 영상은 상세로 받아 미리보기를 채운다.
  useEffect(() => {
    if (!picked?.videoId || picked.uri || picked.playbackUrl) return;
    let cancelled = false;
    api
      .getVideo(picked.videoId)
      .then((video) => {
        if (cancelled || !video.playback_url) return;
        setPicked((was) => (was && was.videoId === video.id ? { ...was, playbackUrl: video.playback_url ?? null } : was));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [picked?.videoId, picked?.uri, picked?.playbackUrl]);

  // 올리는 중이던 영상이 확정되면 그 id로 바꾼다 — 그래야 시작할 수 있다.
  useEffect(() => {
    if (!picked?.pendingId || picked.videoId) return;
    const check = () => {
      const videoId = confirmedVideoFor(picked.pendingId as string);
      if (!videoId) return;
      noteReady();
      setPicked((was) => (was ? { ...was, videoId } : was));
    };
    check();
    return onLibraryChange(check);
  }, [picked?.pendingId, picked?.videoId, noteReady]);

  const videoId = plan.video.kind === 'same' ? plan.video.videoId : picked?.videoId ?? null;
  const uploading = Boolean(picked?.pendingId && !picked.videoId);

  const pickFromLibrary = () => router.push({ pathname: '/archive', params: { pick: '1' } });
  // 영상 상자를 누르면 뜨는 시트(SOMA-656). 시트가 닫힌 뒤에 다음 화면·사진 선택 창을 연다 — iOS 는 닫히는 모달 위에
  // 새 창을 띄우지 못한다.
  const [sourceSheet, setSourceSheet] = useState(false);
  const fromSheet = (action: () => void) => () => {
    setSourceSheet(false);
    setTimeout(action, Platform.OS === 'ios' ? 450 : 0);
  };
  const record = () => router.push({ pathname: '/record-video', params: { mode: 'ai' } });

  const pickFromGallery = async () => {
    if (!user?.id) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsEditing: true, quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const durationMs = normalizeVideoDurationMs(asset.duration ?? null);
    const outcome = await saveRecordingToLibrary({ uri: asset.uri, durationMs, owner: user.id });
    if (outcome.kind === 'rejected') {
      void alert({ title: t('upload.titleNew'), message: videoErrorMessage(outcome.code) });
      return;
    }
    const next = { videoId: null, pendingId: outcome.entry.id, uri: outcome.entry.uri, playbackUrl: null, durationMs };
    setPicked(next);
    notePicked('gallery', next);
  };

  const start = async () => {
    if (startLockRef.current || starting) return;
    if (sample) {
      if (agreedRights) router.replace({ pathname: '/analyzing', params: { practiceId: SAMPLE_PRACTICE_ID } });
      return;
    }
    if (!agreedRights || !canStart(plan, videoId)) return;
    const overflow = sceneOverflow(scene);
    if (overflow) {
      setError(t('start.sceneTooLong'));
      return;
    }
    if (blockageNoteOverflow(blockage)) {
      setError(t('start.noteTooLong'));
      return;
    }
    if (titleOverflow(title)) {
      setError(t('upload.titleTooLong'));
      return;
    }
    startLockRef.current = true;
    setStarting(true);
    setError(null);
    try {
      if (uploading && picked?.pendingId) {
        // 아직 올리는 중이면 확정될 때까지 한 번 밀어 준다(422 video_not_ready 를 미리 피한다).
        await flushLibraryUploads(user?.id ?? '');
        const confirmed = confirmedVideoFor(picked.pendingId);
        if (!confirmed) {
          setError(t('start.stillUploading'));
          return;
        }
        noteReady();
        setPicked({ ...picked, videoId: confirmed });
      }
      const resolvedVideoId = plan.video.kind === 'same' ? plan.video.videoId : picked?.videoId ?? confirmedVideoFor(picked?.pendingId ?? '') ?? null;
      const continueFrom = plan.continueFrom;
      const body = continueFrom
        ? buildContinueBody({ requestId: 'pending', videoId: continueVideoId(plan, resolvedVideoId), scene, blockage })
        : buildStartBody({ requestId: 'pending', videoId: resolvedVideoId as string, scene, blockage, title });
      if (!continueFrom && !resolvedVideoId) {
        setError(t('start.stillUploading'));
        return;
      }
      const attempt = attemptFor(attemptRef.current, fingerprintOf(body), newRequestId);
      attemptRef.current = attempt;
      const practice = continueFrom
        ? await api.continuePractice(continueFrom.practiceId, { ...body, request_id: attempt.requestId })
        : await api.createPractice({ ...body, request_id: attempt.requestId } as Parameters<typeof api.createPractice>[0]);
      startedRef.current = true;
      logEvent('practice_start', { ordinal: practice.ordinal, continued: Boolean(continueFrom) });
      router.replace({ pathname: '/analyzing', params: { practiceId: practice.id } });
    } catch (e) {
      const failure = startFailure(e);
      if (failure.kind === 'in_progress') {
        const open = await api
          .listPracticeGroups('all')
          .then(({ groups }) => inProgressPracticeId(groups, plan.continueFrom?.rootId ?? null))
          .catch(() => null);
        if (open) {
          startedRef.current = true;
          void alert({ title: t('start.inProgressTitle'), message: t('start.inProgressBody') });
          router.replace({ pathname: '/analyzing', params: { practiceId: open } });
          return;
        }
        setError(t('start.inProgressBody'));
        return;
      }
      if (failure.kind === 'fingerprint_mismatch') attemptRef.current = null;
      setError(
        failure.kind === 'video_not_ready'
          ? t('start.stillUploading')
          : failure.kind === 'daily_limit'
            ? t('start.dailyLimit')
            : failure.kind === 'offline'
              ? t('start.offline')
              : videoErrorMessage(e),
      );
    } finally {
      startLockRef.current = false;
      setStarting(false);
    }
  };

  // 같은 영상으로 이어하기면 그 영상의 기기 복사본을 미리보기로 쓴다.
  useEffect(() => {
    if (plan.video.kind !== 'same' || picked) return;
    const sameVideoId = plan.video.videoId;
    let alive = true;
    void localCopyFor(sameVideoId).then((uri) => {
      if (alive && uri) setPicked({ videoId: sameVideoId, pendingId: null, uri, playbackUrl: null, durationMs: null });
    });
    return () => {
      alive = false;
    };
  }, [plan.video, picked]);

  // 질문 받기를 누른 뒤에는 보낸 내용이 바뀌지 않게 입력을 잠근다(SOMA-671).
  const locked = starting;
  const ready = sample ? agreedRights : agreedRights && canStart(plan, videoId) && !uploading;

  // 화면을 떠날 때 보낼 마지막 상태. 올리는 중인 영상도 '고른 영상'으로 친다.
  useEffect(() => {
    exitRef.current = {
      ...exitRef.current,
      hasVideo: canStart(plan, videoId) || uploading,
      uploading,
      rights: agreedRights,
    };
  });
  useEffect(
    () => () => {
      if (sample || startedRef.current) return;
      void logEvent(
        PRACTICE_UPLOAD_EVENTS.screenExit,
        uploadExitParams({
          ...exitRef.current,
          source: sourceRef.current,
          blockedTaps: blockedTapsRef.current,
          now: Date.now(),
        }),
      );
    },
    [sample],
  );
  // 준비가 안 된(회색) 질문 받기를 누르면 무엇에 막혔는지 센다.
  const noteBlocked = () => {
    if (sample) return;
    const reason = startBlockReason({ hasVideo: canStart(plan, videoId) || uploading, uploading, rights: agreedRights });
    if (!reason) return;
    blockedTapsRef.current += 1;
    void logEvent(PRACTICE_UPLOAD_EVENTS.startBlocked, startBlockedParams(reason));
  };
  const toggleRights = () => {
    const next = !agreedRights;
    setAgreedRights(next);
    if (!sample) void logEvent(PRACTICE_UPLOAD_EVENTS.rightsToggle, rightsToggleParams(next));
  };
  // 준비가 끝났으면 버튼만 둔다 — 무엇이 모자란지만 알린다.
  const hint = ready
    ? null
    : !sample && !canStart(plan, videoId)
      ? t('upload.missingVideo')
      : !sample && uploading
        ? t('start.stillUploading')
        : t('upload.missingRights');

  return (
    <SafeAreaView style={styles.safe} edges={keyboardVisible ? [] : ['bottom']}>
      <Stack.Screen
        options={{ title: plan.continueFrom ? t('start.titleContinue') : t('upload.titleNew'), headerShadowVisible: false }}
      />
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Stepper current={videoId || uploading || sample ? 2 : 1} />

          {previewUri || uploading || picked ? (
            <View
              style={styles.pickedBlock}
              ref={sample ? sampleTarget.ref : pickTarget.ref}
              onLayout={sample ? sampleTarget.onLayout : pickTarget.onLayout}>
              {previewUri ? (
                <VideoView style={styles.preview} player={player} nativeControls contentFit="contain" />
              ) : (
                <View style={[styles.preview, styles.previewEmpty]}>
                  <ActivityIndicator color="#fff" />
                </View>
              )}
              <View style={styles.pickedRow}>
                {sample && (
                  <View style={styles.sampleBadge}>
                    <Text style={styles.sampleBadgeText}>{t('tutorial.sampleBadge')}</Text>
                  </View>
                )}
                {plan.video.kind !== 'same' && !sample && (
                  <Pressable style={styles.repick} onPress={() => setSourceSheet(true)}>
                    <Text style={styles.repickText}>{t('upload.repick')}</Text>
                  </Pressable>
                )}
                <Text style={styles.pickedMeta} numberOfLines={1}>
                  {sample
                    ? t('tutorial.sample.situation')
                    : plan.video.kind === 'same'
                    ? t('start.sameVideo')
                    : uploading
                      ? t('archive.statusUploading')
                      : t('archive.statusSaved')}
                </Text>
              </View>
            </View>
          ) : (
            <Pressable
              style={styles.dropzone}
              ref={pickTarget.ref}
              onLayout={pickTarget.onLayout}
              onPress={() => setSourceSheet(true)}
              accessibilityRole="button"
              accessibilityLabel={t('start.pickTitle')}>
              <View style={styles.plusCircle}>
                <Text style={styles.plus}>＋</Text>
              </View>
              <Text style={styles.dropTitle}>{t('start.pickTitle')}</Text>
              <Text style={styles.dropHint}>{t('upload.dropHint')}</Text>
            </Pressable>
          )}

          <View style={styles.sceneCard} ref={sceneTarget.ref} onLayout={sceneTarget.onLayout}>
            {!plan.continueFrom && !sample && (
              <>
                <Text style={styles.sceneTitle}>
                  {t('upload.titleLabel')}
                  <Text style={styles.sceneOptional}>{t('upload.sceneOptional')}</Text>
                </Text>
                <TextInput
                  style={[styles.input, locked && styles.inputLocked]}
                  placeholder={t('upload.titlePh')}
                  placeholderTextColor={palette.checkOff}
                  value={title}
                  onChangeText={setTitle}
                  maxLength={PRACTICE_TITLE_MAX}
                  editable={!locked}
                  returnKeyType="done"
                />
              </>
            )}
            <Text style={[styles.sceneTitle, !plan.continueFrom && !sample && styles.blockGap]}>
              {t('blockage.helpTitle')}
              <Text style={styles.sceneOptional}>{t('upload.sceneOptional')}</Text>
            </Text>
            <View style={styles.chipWrap}>
              {CATEGORIES.map((category) => (
                <Chip
                  key={category}
                  label={t(`blockage.helpLabel.${category}`)}
                  selected={blockage.category === category}
                  disabled={locked}
                  onPress={() =>
                    setBlockage((was) => ({ ...was, category: was.category === category ? null : category, detail: null }))
                  }
                />
              ))}
            </View>

            <Text style={[styles.sceneTitle, styles.blockGap]}>
              {t('blockage.detailTitle')}
              <Text style={styles.sceneOptional}>{t('upload.sceneOptional')}</Text>
            </Text>
            <TextInput
              style={[styles.input, styles.inputTall, locked && styles.inputLocked]}
              placeholder={t('blockage.freePh')}
              placeholderTextColor={palette.checkOff}
              value={blockage.note}
              onChangeText={(note) => setBlockage((was) => ({ ...was, note }))}
              maxLength={BLOCKAGE_NOTE_MAX}
              editable={!locked}
              multiline
            />
          </View>

          <Pressable style={styles.rightsRow} onPress={toggleRights}>
            <View style={[styles.check, agreedRights && styles.checkOn]}>
              {agreedRights && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <Text style={styles.rightsText}>{t('upload.rights')}</Text>
          </Pressable>
          {error && <Text style={styles.errorText}>{error}</Text>}
        </ScrollView>

        <View style={styles.submitBar}>
          <Pressable
            ref={startTarget.ref}
            onLayout={startTarget.onLayout}
            style={[styles.submit, (!ready || starting) && styles.submitDisabled]}
            onPress={() => (ready ? void start() : noteBlocked())}
            disabled={starting}
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready || starting }}>
            {starting ? (
              <ActivityIndicator color={palette.bg} />
            ) : (
              <Text style={styles.submitText}>
                {/* 영상이 아직 올라가는 중이면 무엇을 기다리는지 버튼이 말한다(SOMA-671). */}
                {uploading ? t('upload.submitUploading') : plan.prefilled ? t('upload.submitRetake') : t('upload.submitNew')}
              </Text>
            )}
          </Pressable>
          {hint && <Text style={styles.submitHint}>{hint}</Text>}
        </View>
      </View>
      <VideoSourceSheet
        visible={sourceSheet}
        title={t('start.pickTitle')}
        sub={t('upload.dropHint')}
        onClose={() => setSourceSheet(false)}
        options={[
          { key: 'library', icon: 'archive', title: t('start.fromLibrary'), sub: t('upload.fromLibrarySub'), onPress: fromSheet(pickFromLibrary) },
          { key: 'record', icon: 'video', title: t('upload.recordCta'), sub: t('upload.recordSub'), onPress: fromSheet(record) },
          { key: 'gallery', icon: 'image', title: t('upload.pickGallery'), sub: t('upload.gallerySub'), onPress: fromSheet(() => void pickFromGallery()) },
        ]}
      />
      {dialog}
      {tutorialGuide.element}
    </SafeAreaView>
  );
}

function Chip({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.chip, selected && styles.chipOn, disabled && styles.chipLocked]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  container: { padding: 16, paddingBottom: 28, gap: 16 },

  dropzone: {
    backgroundColor: palette.blueMist,
    borderWidth: 1.5,
    borderColor: '#CFE0F5',
    borderRadius: 18,
    paddingVertical: 34,
    // 버튼 두 개가 테두리에 붙지 않게 좌우 여백을 둔다 (SOMA-494).
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 8,
  },
  plusCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  plus: { fontSize: 22, fontWeight: '900', color: palette.blue },
  dropTitle: { fontSize: 15, fontWeight: '900', color: palette.text },
  dropHint: { fontSize: 12, fontWeight: '600', color: palette.textFaint },

  sampleBadge: { backgroundColor: palette.blueSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  sampleBadgeText: { fontSize: 12.5, fontWeight: '800', color: palette.blue },
  pickedBlock: { gap: 8 },
  preview: { width: '100%', aspectRatio: 16 / 9, borderRadius: 18, backgroundColor: palette.text },
  previewEmpty: { alignItems: 'center', justifyContent: 'center' },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  repick: { backgroundColor: palette.blueSoft, borderRadius: 9999, paddingVertical: 6, paddingHorizontal: 12 },
  repickText: { fontSize: 12, fontWeight: '800', color: palette.blueDeep },
  pickedMeta: { flex: 1, fontSize: 12, fontWeight: '600', color: palette.textFaint },
  errorText: { color: palette.danger, fontSize: 13, fontWeight: '700' },


  sceneCard: { backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.borderSoft, borderRadius: 18, padding: 16, gap: 12 },
  sceneTitle: { fontSize: 15, fontWeight: '900', color: palette.text },
  sceneOptional: { fontWeight: '700', color: palette.textFaint },
  sceneOptionalHint: { fontSize: 12.5, fontWeight: '600', color: palette.textFaint, marginTop: 2 },
  fields: { gap: 12 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12.5, fontWeight: '800', color: palette.textMuted },
  input: {
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: palette.text,
    fontSize: 14,
    fontWeight: '600',
    minHeight: 46,
    textAlignVertical: 'top',
  },
  inputTall: { minHeight: 72 },
  inputLocked: { opacity: 0.5 },

  blockGap: { marginTop: 8 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  chip: { borderRadius: 9999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bgSoft, paddingVertical: 10, paddingHorizontal: 16 },
  chipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  chipLocked: { opacity: 0.5 },
  chipText: { fontSize: 14, fontWeight: '700', color: palette.textDim },
  chipTextOn: { color: palette.blueDeep },

  rightsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, backgroundColor: palette.bgSubtle, borderRadius: 14 },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: palette.checkOff, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: palette.blue, borderColor: palette.blue },
  checkMark: { color: palette.bg, fontSize: 12, fontWeight: '900' },
  rightsText: { flex: 1, fontSize: 12, fontWeight: '600', color: palette.textDim, lineHeight: 19 },

  submitBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    backgroundColor: palette.bg,
  },
  submit: { height: 52, borderRadius: 14, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  submitDisabled: { backgroundColor: '#C9D3DF' },
  submitText: { fontSize: 15, fontWeight: '900', color: palette.bg },
  submitHint: { fontSize: 12, fontWeight: '600', color: palette.textFaint, textAlign: 'center' },
});
