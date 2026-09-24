import * as ImagePicker from 'expo-image-picker';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  ActivityIndicator,
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
import { palette } from '@/constants/palette';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
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
  SCENE_MAX,
  attemptFor,
  blockageNoteOverflow,
  buildContinueBody,
  buildStartBody,
  emptyBlockageDraft,
  fingerprintOf,
  inProgressPracticeId,
  sceneOverflow,
  startFailure,
  type BlockageDraft,
  type SceneDraft,
  type StartAttempt,
} from '@/lib/practice/start';
import { takeContinueOrigin } from '@/lib/practice/session-state';
import type { BlockageCategory, BlockageDetail } from '@/lib/practice/types';
import { newRequestId } from '@/lib/request-id';
import { TARGET } from '@/lib/spotlight-targets';
import { sampleVideoUri } from '@/lib/tutorial-loop';
import { SAMPLE_PRACTICE_ID, sampleScene } from '@/lib/tutorial-sample';
import { normalizeVideoDurationMs } from '@/lib/upload-input';

/**
 * A8·A8.1·A9.x 새 연습 준비(practice.start · practice.resume).
 *
 * 영상은 보관함에서 고르거나 새로 찍는다 — 여기서 올리지 않는다(올리기는 보관함 큐가 한다).
 * 상황·인물·목표와 막힘은 모두 선택이고, 시작을 누르면 회차 하나와 분석 작업 하나가 생긴다.
 * 같은 시도의 재전송은 같은 요청 id 라 회차는 하나다. 묶음에 진행 중 회차가 있으면(409) 그
 * 회차로 돌려보낸다. 이론 선택은 1.0.0에서 뺐다.
 */
const CATEGORIES: BlockageCategory[] = ['분석', '표현', '그 외'];
const EXPRESSION_DETAILS: BlockageDetail[] = ['감정', '움직임', '화술', '표정', '그 외'];
const ANALYSIS_DETAILS: BlockageDetail[] = ['캐릭터 분석', '대사 분석', '그 외'];

function detailsFor(category: BlockageCategory | null): BlockageDetail[] {
  if (category === '표현') return EXPRESSION_DETAILS;
  if (category === '분석') return ANALYSIS_DETAILS;
  return [];
}

export default function UploadScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { alert, confirm, dialog } = useAppDialog();
  const keyboardHeight = useKeyboardHeight();
  const keyboardVisible = keyboardHeight > 0;

  // 튜토리얼의 예시(SOMA-494) — 예시 영상과 장면을 채워 두고, 시작하면 서버 없이 예시 회차로 간다.
  const sample = useLocalSearchParams<{ sample?: string }>().sample === '1';
  const [plan, setPlan] = useState<StartPlan>(() => planFor(sample ? null : takeContinueOrigin()));
  const [picked, setPicked] = useState<PickedVideo | null>(() =>
    sample
      ? { videoId: null, pendingId: null, uri: sampleVideoUri(), playbackUrl: null, durationMs: null }
      : peekPickedVideo(),
  );
  const [scene, setScene] = useState<SceneDraft>(() => (sample ? sampleScene() : plan.scene));
  const [blockage, setBlockage] = useState<BlockageDraft>(emptyBlockageDraft);
  const [agreedRights, setAgreedRights] = useState(sample);
  const pickTarget = useSpotlightTarget(TARGET.uploadPick);
  const sampleTarget = useSpotlightTarget(TARGET.uploadSample);
  const sceneTarget = useSpotlightTarget(TARGET.uploadScene);
  const startTarget = useSpotlightTarget(TARGET.uploadStart);
  const tutorialGuide = useTutorialSpotlight('upload');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef<StartAttempt | null>(null);
  const startLockRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const characterRef = useRef<TextInput>(null);
  const goalRef = useRef<TextInput>(null);
  // 장면 칸을 누르면 그 칸이 화면 맨 위로 오게 올린다 — 키보드가 떠도 적는 칸과 그다음 칸이
  // 한 화면에 보여, 다음 칸을 찾으러 내려가지 않는다.
  const sceneCardY = useRef(0);
  const fieldsY = useRef(0);
  const fieldY = useRef({ situation: 0, character: 0, goal: 0 });
  const scrollFieldToTop = (field: keyof typeof fieldY.current) => () => {
    // 키보드가 올라와 화면이 줄어든 뒤에 올려야 제자리에 선다.
    setTimeout(() => {
      const y = sceneCardY.current + fieldsY.current + fieldY.current[field] - 8;
      scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true });
    }, 250);
  };

  const previewUri = picked?.uri ?? picked?.playbackUrl ?? null;
  const player = useVideoPlayer(previewUri, (p) => {
    p.loop = false;
  });

  // 보관함·촬영·갤러리에서 돌아오면 고른 영상을 받는다.
  useFocusEffect(
    useCallback(() => {
      const next = takePickedVideo();
      if (next) {
        setPicked(next);
        setError(null);
      }
    }, []),
  );

  // 올리는 중이던 영상이 확정되면 그 id로 바꾼다 — 그래야 시작할 수 있다.
  useEffect(() => {
    if (!picked?.pendingId || picked.videoId) return;
    const check = () => {
      const videoId = confirmedVideoFor(picked.pendingId as string);
      if (videoId) setPicked((was) => (was ? { ...was, videoId } : was));
    };
    check();
    return onLibraryChange(check);
  }, [picked?.pendingId, picked?.videoId]);

  const videoId = plan.video.kind === 'same' ? plan.video.videoId : picked?.videoId ?? null;
  const uploading = Boolean(picked?.pendingId && !picked.videoId);

  const pickFromLibrary = () => router.push({ pathname: '/archive', params: { pick: '1' } });
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
    setPicked({ videoId: null, pendingId: outcome.entry.id, uri: outcome.entry.uri, playbackUrl: null, durationMs });
  };

  /** A8.1 "이전 연습 이어서 하기" — 이어갈 묶음을 고른다. 진행 중 회차가 있으면 그리로 보낸다. */
  const chooseGroup = async () => {
    try {
      const { groups } = await api.listPracticeGroups('all');
      const open = inProgressPracticeId(groups);
      if (open) {
        void alert({ title: t('start.inProgressTitle'), message: t('start.inProgressBody') });
        router.replace({ pathname: '/analyzing', params: { practiceId: open } });
        return;
      }
      if (groups.length === 0) {
        void alert({ title: t('start.continueTitle'), message: t('start.noGroups') });
        return;
      }
      const chosen = await new Promise<string | null>((resolve) => {
        void confirm({
          title: t('start.continueTitle'),
          message: t('start.continueBody', { title: groups[0].title ?? t('history.noSceneTitle'), count: groups[0].ordinal_count }),
          confirmLabel: t('start.continueConfirm'),
          cancelLabel: t('common.cancel'),
        }).then((ok) => resolve(ok ? groups[0].root_id : null));
      });
      if (!chosen) return;
      const group = groups.find((g) => g.root_id === chosen);
      if (!group) return;
      setPlan(planFor({ kind: 'group', rootId: group.root_id, practiceId: group.root_id }));
    } catch (e) {
      void alert({ title: t('start.continueTitle'), message: videoErrorMessage(e) });
    }
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
        setPicked({ ...picked, videoId: confirmed });
      }
      const resolvedVideoId = plan.video.kind === 'same' ? plan.video.videoId : picked?.videoId ?? confirmedVideoFor(picked?.pendingId ?? '') ?? null;
      const continueFrom = plan.continueFrom;
      const body = continueFrom
        ? buildContinueBody({ requestId: 'pending', videoId: continueVideoId(plan, resolvedVideoId), scene, blockage })
        : buildStartBody({ requestId: 'pending', videoId: resolvedVideoId as string, scene, blockage });
      if (!continueFrom && !resolvedVideoId) {
        setError(t('start.stillUploading'));
        return;
      }
      const attempt = attemptFor(attemptRef.current, fingerprintOf(body), newRequestId);
      attemptRef.current = attempt;
      const practice = continueFrom
        ? await api.continuePractice(continueFrom.practiceId, { ...body, request_id: attempt.requestId })
        : await api.createPractice({ ...body, request_id: attempt.requestId } as Parameters<typeof api.createPractice>[0]);
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

  const ready = sample ? agreedRights : agreedRights && canStart(plan, videoId) && !uploading;
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

          {previewUri || uploading ? (
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
                  <Pressable style={styles.repick} onPress={pickFromLibrary}>
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
            <View style={styles.dropzone} ref={pickTarget.ref} onLayout={pickTarget.onLayout}>
              <View style={styles.plusCircle}>
                <Text style={styles.plus}>＋</Text>
              </View>
              <Text style={styles.dropTitle}>{t('start.pickTitle')}</Text>
              <Text style={styles.dropHint}>{t('upload.dropHint')}</Text>
              <View style={styles.pickActions}>
                <Pressable style={styles.recordBtn} onPress={pickFromLibrary}>
                  <Text style={styles.recordBtnText}>{t('start.fromLibrary')}</Text>
                </Pressable>
                <Pressable style={styles.galleryBtn} onPress={record}>
                  <Text style={styles.galleryBtnText}>{t('upload.recordCta')}</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => void pickFromGallery()}>
                <Text style={styles.galleryLink}>{t('upload.pickGallery')}</Text>
              </Pressable>
            </View>
          )}

          {!plan.continueFrom && !sample && (
            <Pressable style={styles.continueRow} onPress={() => void chooseGroup()}>
              <Text style={styles.continueText}>{t('start.continueCta')}</Text>
            </Pressable>
          )}

          <View style={styles.sceneCard} onLayout={(e) => (sceneCardY.current = e.nativeEvent.layout.y)}>
            <Text style={styles.sceneTitle}>
              {t('upload.sceneTitle')}
              <Text style={styles.sceneOptional}>{t('upload.sceneOptional')}</Text>
            </Text>
            <Text style={styles.sceneOptionalHint}>{t('upload.sceneHint')}</Text>
            {/* 카드 전체는 화면보다 길어 설명이 비출 곳을 가린다 — 세 칸만 비춘다. */}
            <View
              style={styles.fields}
              ref={sceneTarget.ref}
              onLayout={(e) => {
                fieldsY.current = e.nativeEvent.layout.y;
                sceneTarget.onLayout();
              }}>
              <Field
                label={t('upload.situation')}
                placeholder={t('upload.situationPh')}
                value={scene.situation}
                onChangeText={(situation) => setScene((s) => ({ ...s, situation }))}
                onFocus={scrollFieldToTop('situation')}
                onY={(y) => (fieldY.current.situation = y)}
                returnKeyType="next"
                onSubmitEditing={() => characterRef.current?.focus()}
              />
              <Field
                label={t('upload.character')}
                placeholder={t('upload.characterPh')}
                value={scene.character}
                onChangeText={(character) => setScene((s) => ({ ...s, character }))}
                onFocus={scrollFieldToTop('character')}
                onY={(y) => (fieldY.current.character = y)}
                inputRef={characterRef}
                returnKeyType="next"
                onSubmitEditing={() => goalRef.current?.focus()}
              />
              <Field
                label={t('upload.goal')}
                placeholder={t('upload.goalPh')}
                value={scene.goal}
                onChangeText={(goal) => setScene((s) => ({ ...s, goal }))}
                onFocus={scrollFieldToTop('goal')}
                onY={(y) => (fieldY.current.goal = y)}
                tall
                inputRef={goalRef}
                returnKeyType="done"
                onSubmitEditing={() => {
                  goalRef.current?.blur();
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
                }}
              />
            </View>
          </View>

          <View style={styles.sceneCard}>
            <Text style={styles.sceneTitle}>{t('blockage.helpTitle')}</Text>
            <Text style={styles.sceneOptionalHint}>{t('blockage.helpHint')}</Text>
            <View style={styles.chipWrap}>
              {CATEGORIES.map((category) => (
                <Chip
                  key={category}
                  label={t(`blockage.helpLabel.${category}`)}
                  selected={blockage.category === category}
                  onPress={() =>
                    setBlockage((was) =>
                      was.category === category
                        ? { ...was, category: null, detail: null }
                        : { ...was, category, detail: null },
                    )
                  }
                />
              ))}
            </View>

            {detailsFor(blockage.category).length > 0 && (
              <View style={styles.chipWrap}>
                {detailsFor(blockage.category).map((detail) => (
                  <Chip
                    key={detail}
                    label={t(`blockage.kindLabel.${detail}`)}
                    selected={blockage.detail === detail}
                    onPress={() => setBlockage((was) => ({ ...was, detail: was.detail === detail ? null : detail }))}
                  />
                ))}
              </View>
            )}

            <Text style={[styles.sceneTitle, styles.blockGap]}>{t('blockage.detailTitle')}</Text>
            <Text style={styles.sceneOptionalHint}>{t('blockage.detailHint')}</Text>
            <TextInput
              style={[styles.input, styles.inputTall]}
              placeholder={t('blockage.freePh')}
              placeholderTextColor={palette.checkOff}
              value={blockage.note}
              onChangeText={(note) => setBlockage((was) => ({ ...was, note }))}
              maxLength={BLOCKAGE_NOTE_MAX}
              multiline
            />
          </View>

          <Pressable style={styles.rightsRow} onPress={() => setAgreedRights((v) => !v)}>
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
            onPress={() => void start()}
            disabled={!ready || starting}>
            {starting ? (
              <ActivityIndicator color={palette.bg} />
            ) : (
              <Text style={styles.submitText}>{plan.prefilled ? t('upload.submitRetake') : t('upload.submitNew')}</Text>
            )}
          </Pressable>
          {hint && <Text style={styles.submitHint}>{hint}</Text>}
        </View>
      </View>
      {dialog}
      {tutorialGuide.element}
    </SafeAreaView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, selected && styles.chipOn]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/** 라벨 위, 입력 아래. 세 칸이 같은 모양이라 하나로 묶는다. 300자에서 화면이 먼저 막는다. */
function Field({
  label,
  placeholder,
  value,
  onChangeText,
  tall,
  inputRef,
  returnKeyType,
  onSubmitEditing,
  onFocus,
  onY,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  tall?: boolean;
  inputRef?: RefObject<TextInput | null>;
  returnKeyType?: 'next' | 'done';
  onSubmitEditing?: () => void;
  onFocus?: () => void;
  /** 세 칸 묶음 안에서 이 칸의 위쪽 위치 — 누르면 여기를 화면 맨 위로 올린다. */
  onY?: (y: number) => void;
}) {
  return (
    <View style={styles.field} onLayout={(e) => onY?.(e.nativeEvent.layout.y)}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        ref={inputRef}
        style={[styles.input, tall && styles.inputTall]}
        placeholder={placeholder}
        placeholderTextColor={palette.checkOff}
        value={value}
        onChangeText={onChangeText}
        maxLength={SCENE_MAX}
        multiline
        submitBehavior="submit"
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        onFocus={onFocus}
      />
    </View>
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
    alignItems: 'center',
    gap: 8,
  },
  pickActions: { flexDirection: 'row', gap: 10, marginTop: 16, alignSelf: 'stretch' },
  recordBtn: { flex: 1, backgroundColor: palette.blue, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  recordBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  galleryBtn: { flex: 1, backgroundColor: palette.bgSoft, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  galleryBtnText: { color: palette.textDim, fontSize: 15, fontWeight: '600' },
  galleryLink: { color: palette.blueDeep, fontSize: 13, fontWeight: '700', marginTop: 12 },
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

  continueRow: { alignSelf: 'flex-start', paddingVertical: 6 },
  continueText: { color: palette.blueDeep, fontSize: 13.5, fontWeight: '800' },

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

  blockGap: { marginTop: 8 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  chip: { borderRadius: 9999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bgSoft, paddingVertical: 10, paddingHorizontal: 16 },
  chipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
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
