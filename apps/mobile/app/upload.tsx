import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState, type RefObject, useCallback } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FirstUploadGuide } from '@/components/first-upload-guide';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { beginAnalysisNavigation } from '@/lib/analysis-entry';
import type { VideoFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setPendingUpload, takePrefill } from '@/lib/practice';
import { takeRecordedVideo } from '@/lib/recorded-video';
import {
  MAX_VIDEO_DURATION_MS,
  missingUploadFieldsHint,
  normalizeVideoDurationMs,
} from '@/lib/upload-input';
import { palette } from '@/constants/palette';
import { Stepper } from '@/components/practice-chrome';
import { translate as t } from '@/lib/i18n';

/**
 * A2. 영상 올리기 + 의도 입력 — 영상과 "이 장면에서 뭘 하려 했는지"를 받는다.
 * 기록에서 "같은 장면 다시 찍기"로 들어오면 장면 정보가 미리 채워진다(프리필만, 비교 로직 없음).
 */
export default function UploadScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const keyboardHeight = useKeyboardHeight();
  // SafeAreaView가 이미 하단 인셋을 비워두므로 그만큼 빼고 올린다([[use-keyboard-height]]).
  const keyboardVisible = keyboardHeight > 0;
  const [prefilled, setPrefilled] = useState(false);
  // 이어서 연습 — 렌더와 무관하고 제출 시 한 번 실린다.
  const continuedFromRef = useRef<string | null>(null);
  const [situation, setSituation] = useState('');
  const [character, setCharacter] = useState('');
  const [goal, setGoal] = useState('');
  const [video, setVideo] = useState<VideoFile | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [agreedRights, setAgreedRights] = useState(false);
  const startLockRef = useRef(false);
  const [starting, setStarting] = useState(false);
  // 키보드 "다음"으로 상황 → 인물 → 목표가 이어지고, 목표를 마치면 동의 체크가 바로 보인다.
  const scrollRef = useRef<ScrollView>(null);
  const characterRef = useRef<TextInput>(null);
  const goalRef = useRef<TextInput>(null);
  // 고른 영상을 그 자리에서 확인할 수 있게 미리보기를 붙인다(목업 M5).
  const player = useVideoPlayer(video?.uri ?? null, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    const p = takePrefill();
    if (!p) return;
    if (p.continuedFrom) continuedFromRef.current = p.continuedFrom;
    if (!p.scene) return;
    setPrefilled(true);
    setSituation(p.scene.situation);
    setCharacter(p.scene.character);
    setGoal(p.scene.goal);
  }, []);

  const MAX_RAW_MB = 4096;

  // 갤러리·촬영이 공통으로 쓰는 검증. 길이·용량이 상한을 넘으면 문구만 세우고 버린다.
  const acceptVideo = (input: {
    uri: string;
    durationMs: number | null;
    sizeBytes?: number | null;
    name: string;
    mimeType?: string | null;
  }): void => {
    setVideoError(null);
    const normalizedDurationMs = normalizeVideoDurationMs(input.durationMs);
    if (normalizedDurationMs !== null && normalizedDurationMs > MAX_VIDEO_DURATION_MS) {
      const durationSec = normalizedDurationMs / 1000;
      setVideoError(
        t('upload.tooLong', {
          min: Math.floor(durationSec / 60),
          sec: Math.round(durationSec % 60),
        }),
      );
      return;
    }
    const sizeMb = input.sizeBytes ? input.sizeBytes / (1024 * 1024) : 0;
    if (sizeMb > MAX_RAW_MB) {
      setVideoError(t('upload.tooBig', { gb: Math.round(sizeMb / 1024) }));
      return;
    }
    setDurationMs(normalizedDurationMs);
    setVideo({
      uri: input.uri,
      name: input.name,
      mimeType: input.mimeType ?? 'video/mp4',
    });
  };

  const pickVideo = async () => {
    setVideoError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: true, // iOS는 선택 직후 트리밍 UI 제공 (Android는 무시됨)
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    acceptVideo({
      uri: asset.uri,
      durationMs: asset.duration ?? null,
      sizeBytes: asset.fileSize,
      name: asset.fileName ?? 'video.mp4',
      mimeType: asset.mimeType,
    });
  };

  // 촬영 화면에서 돌아오면 찍은 영상을 받아 검증·적용한다 (SOMA-477).
  useFocusEffect(
    useCallback(() => {
      const rec = takeRecordedVideo();
      if (rec) acceptVideo({ uri: rec.uri, durationMs: rec.durationMs, name: rec.name });
    }, []),
  );

  // 장면 세 칸은 선택이다(SOMA-432) — 비우면 코치가 대화에서 물어본다.
  const canSubmit = video && agreedRights;

  const start = () => {
    if (!canSubmit || !video) return;
    beginAnalysisNavigation(
      startLockRef,
      () => {
        setStarting(true);
        setPendingUpload({
          scene: {
            situation: situation.trim(),
            character: character.trim(),
            goal: goal.trim(),
          },
          video,
          durationMs,
          // 막히는 지점은 다음 화면에서 고른다. 여기서 채우면 분기가 늘 '그 외'가 된다.
          blockage: null,
          continuedFrom: continuedFromRef.current,
        });
      },
      // 분석 전에 막히는 지점을 먼저 고른다 — 서버가 그 값으로 코치를 가른다.
      () => router.replace('/blockage'),
    );
  };

  const submitDisabled = !canSubmit || starting;
  const missingHint = missingUploadFieldsHint({
    situation,
    character,
    goal,
    hasVideo: !!video,
    agreedRights,
  });

  const durationText =
    durationMs !== null
      ? t('common.minSec', { min: Math.floor(durationMs / 60000), sec: Math.round((durationMs % 60000) / 1000) })
      : null;

  return (
    <SafeAreaView style={styles.safe} edges={keyboardVisible ? [] : ['bottom']}>
      <Stack.Screen
        options={{
          title: prefilled ? t('upload.titleRetake') : t('upload.titleNew'),
          headerShadowVisible: false,
        }}
      />
      {!prefilled && user && <FirstUploadGuide ownerId={user.id} />}
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled">
          <Stepper current={video ? 2 : 1} />

          {video ? (
            <View style={styles.pickedBlock}>
              <VideoView
                style={styles.preview}
                player={player}
                nativeControls
                contentFit="contain"
              />
              <View style={styles.pickedRow}>
                <Pressable style={styles.repick} onPress={pickVideo}>
                  <Text style={styles.repickText}>{t('upload.repick')}</Text>
                </Pressable>
                <Text style={styles.pickedMeta} numberOfLines={1}>
                  {video.name}
                  {durationText ? ` · ${durationText}` : ''}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.dropzone}>
              <View style={styles.plusCircle}>
                <Text style={styles.plus}>＋</Text>
              </View>
              <Text style={styles.dropTitle}>{t('upload.dropTitle')}</Text>
              <Text style={styles.dropHint}>{t('upload.dropHint')}</Text>
              <View style={styles.pickActions}>
                <Pressable style={styles.recordBtn} onPress={() => router.push('/record-video')}>
                  <Text style={styles.recordBtnText}>{t('upload.recordCta')}</Text>
                </Pressable>
                <Pressable style={styles.galleryBtn} onPress={pickVideo}>
                  <Text style={styles.galleryBtnText}>{t('upload.pickGallery')}</Text>
                </Pressable>
              </View>
            </View>
          )}
          {videoError && <Text style={styles.errorText}>{videoError}</Text>}

          <View style={styles.sceneCard}>
            <Text style={styles.sceneTitle}>
              {t('upload.sceneTitle')}
              <Text style={styles.sceneOptional}>{t('upload.sceneOptional')}</Text>
            </Text>
            <Text style={styles.sceneOptionalHint}>
              {t('upload.sceneHint')}
            </Text>
            <View style={styles.fields}>
              <Field
                label={t('upload.situation')}
                placeholder={t('upload.situationPh')}
                value={situation}
                onChangeText={setSituation}
                returnKeyType="next"
                onSubmitEditing={() => characterRef.current?.focus()}
              />
              <Field
                label={t('upload.character')}
                placeholder={t('upload.characterPh')}
                value={character}
                onChangeText={setCharacter}
                inputRef={characterRef}
                returnKeyType="next"
                onSubmitEditing={() => goalRef.current?.focus()}
              />
              <Field
                label={t('upload.goal')}
                placeholder={t('upload.goalPh')}
                value={goal}
                onChangeText={setGoal}
                tall
                inputRef={goalRef}
                returnKeyType="done"
                onSubmitEditing={() => {
                  // 키보드를 내리고 동의 체크(이어하기면 '이대로 이어가기')가 바로 보이게 한다.
                  goalRef.current?.blur();
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
                }}
              />
            </View>
          </View>

          <Pressable style={styles.rightsRow} onPress={() => setAgreedRights((v) => !v)}>
            <View style={[styles.check, agreedRights && styles.checkOn]}>
              {agreedRights && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <Text style={styles.rightsText}>
              {t('upload.rights')}
            </Text>
          </Pressable>
        </ScrollView>

        {/* 입력은 위에서 아래로, 실행은 아래에서 위로 — 버튼은 하단에 고정한다. */}
        <View style={styles.submitBar}>
          <Pressable
            style={[styles.submit, submitDisabled && styles.submitDisabled]}
            onPress={start}
            disabled={submitDisabled}>
            <Text style={styles.submitText}>{prefilled ? t('upload.submitRetake') : t('upload.submitNew')}</Text>
          </Pressable>
          <Text style={styles.submitHint}>
            {canSubmit
              ? t('upload.submitHintReady')
              : missingHint || t('upload.submitHintDefault')}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

/** 라벨 위, 입력 아래. 세 칸이 같은 모양이라 하나로 묶는다. */
function Field({
  label,
  placeholder,
  value,
  onChangeText,
  tall,
  inputRef,
  returnKeyType,
  onSubmitEditing,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  tall?: boolean;
  inputRef?: RefObject<TextInput | null>;
  returnKeyType?: 'next' | 'done';
  onSubmitEditing?: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        ref={inputRef}
        style={[styles.input, tall && styles.inputTall]}
        placeholder={placeholder}
        placeholderTextColor={palette.checkOff}
        value={value}
        onChangeText={onChangeText}
        multiline
        // 여러 줄 입력에서도 엔터가 줄바꿈 대신 "다음 칸"으로 가게 한다 —
        // 세 칸 모두 한두 줄짜리라 줄바꿈보다 이어지는 흐름이 낫다.
        submitBehavior="submit"
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
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
  recordBtn: {
    flex: 1,
    backgroundColor: palette.blue,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  recordBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  galleryBtn: {
    flex: 1,
    backgroundColor: palette.bgSoft,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  galleryBtnText: { color: palette.textDim, fontSize: 15, fontWeight: '600' },
  plusCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: { fontSize: 22, fontWeight: '900', color: palette.blue },
  dropTitle: { fontSize: 15, fontWeight: '900', color: palette.text },
  dropHint: { fontSize: 12, fontWeight: '600', color: palette.textFaint },

  pickedBlock: { gap: 8 },
  preview: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 18,
    backgroundColor: palette.text,
  },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  repick: {
    backgroundColor: palette.blueSoft,
    borderRadius: 9999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  repickText: { fontSize: 12, fontWeight: '800', color: palette.blueDeep },
  pickedMeta: { flex: 1, fontSize: 12, fontWeight: '600', color: palette.textFaint },
  errorText: { color: palette.danger, fontSize: 13, fontWeight: '700' },

  sceneCard: {
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
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

  rightsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    backgroundColor: palette.bgSubtle,
    borderRadius: 14,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: palette.checkOff,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: palette.blue, borderColor: palette.blue },
  checkMark: { color: palette.bg, fontSize: 12, fontWeight: '900' },
  rightsText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: palette.textDim,
    lineHeight: 19,
  },

  submitBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    backgroundColor: palette.bg,
  },
  submit: {
    height: 52,
    borderRadius: 14,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitDisabled: { backgroundColor: '#C9D3DF' },
  submitText: { fontSize: 15, fontWeight: '900', color: palette.bg },
  submitHint: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.textFaint,
    textAlign: 'center',
  },
});

