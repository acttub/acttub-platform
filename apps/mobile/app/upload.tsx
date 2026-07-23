import { useHeaderHeight } from '@react-navigation/elements';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FirstUploadGuide } from '@/components/first-upload-guide';
import { beginAnalysisNavigation } from '@/lib/analysis-entry';
import type { VideoFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setPendingUpload, takePrefill } from '@/lib/practice';
import {
  MAX_VIDEO_DURATION_MS,
  normalizeVideoDurationMs,
} from '@/lib/upload-input';
import { palette } from '@/constants/palette';

/**
 * A2. 영상 올리기 + 의도 입력 — 영상과 "이 장면에서 뭘 하려 했는지"를 받는다.
 * 기록에서 "같은 장면 다시 찍기"로 들어오면 장면 정보가 미리 채워진다(프리필만, 비교 로직 없음).
 */
export default function UploadScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const headerHeight = useHeaderHeight();
  const [prefilled, setPrefilled] = useState(false);
  const [situation, setSituation] = useState('');
  const [character, setCharacter] = useState('');
  const [subtext, setSubtext] = useState('');
  const [video, setVideo] = useState<VideoFile | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [agreedRights, setAgreedRights] = useState(false);
  const startLockRef = useRef(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const p = takePrefill();
    if (!p) return;
    setPrefilled(true);
    setSituation(p.situation);
    setCharacter(p.character);
    setSubtext(p.subtext);
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
    situation.trim() && character.trim() && subtext.trim() && video && agreedRights;

  const start = () => {
    if (!canSubmit || !video) return;
    beginAnalysisNavigation(
      startLockRef,
      () => {
        setStarting(true);
        setPendingUpload({
          subtext: {
            situation: situation.trim(),
            character: character.trim(),
            subtext: subtext.trim(),
          },
          video,
          durationMs,
        });
      },
      () => router.replace('/analyzing'),
    );
  };

  const submitDisabled = !canSubmit || starting;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: prefilled ? '같은 장면 다시 찍기' : '영상 올리기' }} />
      {!prefilled && user && <FirstUploadGuide ownerId={user.id} />}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.guide}>
            이 장면에서 뭘 하려 하셨는지 알려주시면, 그 의도를 기준으로 봐드릴게요.
          </Text>

          <Text style={styles.label}>연기 영상</Text>
          <Pressable style={[styles.videoPicker, video && styles.videoPicked]} onPress={pickVideo}>
            <Text style={video ? styles.videoPickedText : styles.videoPickerText}>
              {video ? `🎬 ${video.name}` : '갤러리에서 영상 선택 (mp4·mov, 5분 이내)'}
            </Text>
          </Pressable>
          {videoError && <Text style={styles.errorText}>{videoError}</Text>}

          <Text style={styles.label}>어떤 상황인가요?</Text>
          <TextInput
            style={styles.input}
            placeholder="예: 이별을 통보받은 직후, 카페에서"
            placeholderTextColor={palette.textDim}
            value={situation}
            onChangeText={setSituation}
            multiline
          />

          <Text style={styles.label}>어떤 인물인가요?</Text>
          <TextInput
            style={styles.input}
            placeholder="예: 겉으로는 담담하려 애쓰는 20대 후반 여성"
            placeholderTextColor={palette.textDim}
            value={character}
            onChangeText={setCharacter}
            multiline
          />

          <Text style={styles.label}>뭘 보여주고 싶으셨나요? (의도)</Text>
          <TextInput
            style={[styles.input, styles.inputTall]}
            placeholder="예: 꾹 참다 끝에 무너지는 걸 보여주고 싶었어요"
            placeholderTextColor={palette.textDim}
            value={subtext}
            onChangeText={setSubtext}
            multiline
          />

          <Pressable style={styles.rightsRow} onPress={() => setAgreedRights((v) => !v)}>
            <View style={[styles.check, agreedRights && styles.checkOn]}>
              {agreedRights && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <Text style={styles.rightsText}>
              본인이 촬영·업로드할 권리가 있고, 영상에 나오는 다른 사람의 촬영·처리 동의를
              받았으며, 대본·음원·영상의 저작권과 초상권을 침해하지 않습니다.
            </Text>
          </Pressable>

          <Pressable
            style={[styles.submit, submitDisabled && styles.submitDisabled]}
            onPress={start}
            disabled={submitDisabled}>
            <Text style={styles.submitText}>분석 시작</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  container: { padding: 20, paddingBottom: 40 },
  guide: { fontSize: 14, color: palette.textDim, lineHeight: 21, marginBottom: 8 },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.text,
    marginBottom: 6,
    marginTop: 18,
  },
  input: {
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    padding: 14,
    color: palette.text,
    fontSize: 15,
    minHeight: 48,
  },
  inputTall: { minHeight: 76 },
  videoPicker: {
    backgroundColor: palette.card,
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: palette.blue,
    borderStyle: 'dashed',
  },
  videoPicked: { borderStyle: 'solid', backgroundColor: palette.blueSoft },
  videoPickerText: { color: palette.blue, fontSize: 14, fontWeight: '600' },
  videoPickedText: { color: palette.text, fontSize: 14, fontWeight: '600' },
  errorText: { color: palette.danger, fontSize: 13, marginTop: 6 },
  rightsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 28,
    padding: 14,
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: palette.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkOn: { backgroundColor: palette.blue, borderColor: palette.blue },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '900' },
  rightsText: { flex: 1, fontSize: 12, color: palette.textDim, lineHeight: 18 },
  submit: {
    backgroundColor: palette.blue,
    borderRadius: 16,
    padding: 17,
    alignItems: 'center',
    marginTop: 14,
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
