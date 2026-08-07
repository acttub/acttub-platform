import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
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
import {
  MAX_VIDEO_DURATION_MS,
  missingUploadFieldsHint,
  normalizeVideoDurationMs,
} from '@/lib/upload-input';
import { palette } from '@/constants/palette';
import { Stepper } from '@/components/practice-chrome';

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
  const [situation, setSituation] = useState('');
  const [character, setCharacter] = useState('');
  const [goal, setGoal] = useState('');
  const [video, setVideo] = useState<VideoFile | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [agreedRights, setAgreedRights] = useState(false);
  const startLockRef = useRef(false);
  const [starting, setStarting] = useState(false);
  // 고른 영상을 그 자리에서 확인할 수 있게 미리보기를 붙인다(목업 M5).
  const player = useVideoPlayer(video?.uri ?? null, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    const p = takePrefill();
    if (!p) return;
    setPrefilled(true);
    setSituation(p.situation);
    setCharacter(p.character);
    setGoal(p.goal);
  }, []);

  const MAX_RAW_MB = 4096;

  const pickVideo = async () => {
    setVideoError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: true, // iOS는 선택 직후 트리밍 UI 제공 (Android는 무시됨)
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const normalizedDurationMs = normalizeVideoDurationMs(asset.duration);
    if (normalizedDurationMs !== null && normalizedDurationMs > MAX_VIDEO_DURATION_MS) {
      const durationSec = normalizedDurationMs / 1000;
      const min = Math.floor(durationSec / 60);
      const sec = Math.round(durationSec % 60);
      setVideoError(`영상이 ${min}분 ${sec}초예요. 5분 이내로 잘라서 올려주세요.`);
      return;
    }
    const sizeMb = asset.fileSize ? asset.fileSize / (1024 * 1024) : 0;
    if (sizeMb > MAX_RAW_MB) {
      setVideoError(`영상이 ${Math.round(sizeMb / 1024)}GB예요. 너무 커서 기기에서 처리할 수 없어요.`);
      return;
    }
    setDurationMs(normalizedDurationMs);
    setVideo({
      uri: asset.uri,
      name: asset.fileName ?? 'video.mp4',
      mimeType: asset.mimeType ?? 'video/mp4',
    });
  };

  const canSubmit =
    situation.trim() && character.trim() && goal.trim() && video && agreedRights;

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
      ? `${Math.floor(durationMs / 60000)}분 ${Math.round((durationMs % 60000) / 1000)}초`
      : null;

  return (
    <SafeAreaView style={styles.safe} edges={keyboardVisible ? [] : ['bottom']}>
      <Stack.Screen
        options={{
          title: prefilled ? '같은 장면 다시 찍기' : '새 연습',
          headerShadowVisible: false,
        }}
      />
      {!prefilled && user && <FirstUploadGuide ownerId={user.id} />}
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ScrollView
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
                  <Text style={styles.repickText}>영상 다시 선택</Text>
                </Pressable>
                <Text style={styles.pickedMeta} numberOfLines={1}>
                  {video.name}
                  {durationText ? ` · ${durationText}` : ''}
                </Text>
              </View>
            </View>
          ) : (
            <Pressable style={styles.dropzone} onPress={pickVideo}>
              <View style={styles.plusCircle}>
                <Text style={styles.plus}>＋</Text>
              </View>
              <Text style={styles.dropTitle}>오늘의 연기 영상을 올려 주세요</Text>
              <Text style={styles.dropHint}>MP4 · MOV · 5분 이내</Text>
            </Pressable>
          )}
          {videoError && <Text style={styles.errorText}>{videoError}</Text>}

          <View style={styles.sceneCard}>
            <Text style={styles.sceneTitle}>이 장면에서 무엇을 연기했는지 알려 주세요</Text>
            <View style={styles.fields}>
              <Field
                label="상황"
                placeholder="예: 이별을 통보받은 직후, 카페에서"
                value={situation}
                onChangeText={setSituation}
              />
              <Field
                label="인물"
                placeholder="예: 담담한 척하는 20대 후반 여성"
                value={character}
                onChangeText={setCharacter}
              />
              <Field
                label="목표"
                placeholder="예: 상대가 마음을 돌려 다시 앉게 만들기"
                value={goal}
                onChangeText={setGoal}
                tall
              />
            </View>
          </View>

          <Pressable style={styles.rightsRow} onPress={() => setAgreedRights((v) => !v)}>
            <View style={[styles.check, agreedRights && styles.checkOn]}>
              {agreedRights && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <Text style={styles.rightsText}>
              본인이 촬영·업로드할 권리가 있고, 영상에 나오는 다른 사람의 촬영·처리 동의를
              받았으며, 대본·음원·영상의 저작권과 초상권을 침해하지 않습니다.
            </Text>
          </Pressable>
        </ScrollView>

        {/* 입력은 위에서 아래로, 실행은 아래에서 위로 — 버튼은 하단에 고정한다. */}
        <View style={styles.submitBar}>
          <Pressable
            style={[styles.submit, submitDisabled && styles.submitDisabled]}
            onPress={start}
            disabled={submitDisabled}>
            <Text style={styles.submitText}>질문 받기</Text>
          </Pressable>
          <Text style={styles.submitHint}>
            {canSubmit
              ? '누르면 장면을 보고 질문을 만들어요'
              : missingHint || '영상을 올리면 시작할 수 있어요'}
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
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  tall?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, tall && styles.inputTall]}
        placeholder={placeholder}
        placeholderTextColor={palette.checkOff}
        value={value}
        onChangeText={onChangeText}
        multiline
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

