import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { TODAY_LINE } from '@/lib/challenge-mock';
import { translate as t } from '@/lib/i18n';
import { peekRecordedVideo, takeRecordedVideo, type RecordedVideo } from '@/lib/recorded-video';

type Mode = 'public' | 'private';

/**
 * A18.1/A18.2 올리기 → A18.3 완료 — 찍은 영상을 챌린지에 공개로 올리거나 비공개로 보관한다.
 *
 * 백엔드가 없어 올리기는 예시(previewNote)다: 제출하면 완료 화면만 보여준다. 촬영 결과는
 * peek 만 한다 — "AI 리포트 받기"가 업로드 화면으로 넘겨야 해서 홈으로 갈 때만 버린다.
 */
export default function ChallengeUploadScreen() {
  const router = useRouter();
  const [video] = useState<RecordedVideo | null>(() => peekRecordedVideo());
  const [caption, setCaption] = useState('');
  const [mode, setMode] = useState<Mode>('public');
  const [done, setDone] = useState(false);
  const player = useVideoPlayer(video?.uri ?? null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  const sec = video?.durationMs ? Math.round(video.durationMs / 1000) : null;
  const mmss = sec !== null ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '';

  const submit = () => {
    logEvent('challenge_upload_submit', { mode, hasCaption: caption.trim().length > 0 });
    setDone(true);
  };
  const goHome = () => {
    takeRecordedVideo();
    router.replace('/');
  };
  const getReport = () => {
    logEvent('challenge_upload_report', { mode });
    // 촬영 결과를 남겨두면 업로드 화면이 포커스되며 받아 붙인다.
    router.replace('/upload');
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.doneWrap}>
          <View style={styles.doneIcon}>
            <Feather name="check" size={30} color={palette.blue} />
          </View>
          <Text style={styles.doneTitle}>{t(mode === 'public' ? 'challengeUpload.doneTitle' : 'challengeUpload.doneTitlePrivate')}</Text>
          <Text style={styles.doneSub}>{t(mode === 'public' ? 'challengeUpload.doneSub' : 'challengeUpload.doneSubPrivate')}</Text>
          <Pressable style={({ pressed }) => [styles.primary, styles.doneBtn, pressed && styles.pressed]} onPress={goHome} accessibilityRole="button">
            <Text style={styles.primaryText}>{t('challengeUpload.goHome')}</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.ghost, styles.doneBtn, pressed && styles.pressed]} onPress={getReport} accessibilityRole="button">
            <Text style={styles.ghostText}>{t('challengeUpload.getReport')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('challengeUpload.title') }} />
      <KeyboardAwareScroll contentContainerStyle={styles.content}>
        <View style={styles.headRow}>
          <View style={styles.thumbWrap}>
            {video ? (
              <VideoView style={styles.thumb} player={player} contentFit="cover" nativeControls={false} />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <Feather name="video" size={18} color={palette.textFaint} />
              </View>
            )}
          </View>
          <View style={styles.flex}>
            <Text style={styles.meta}>
              {TODAY_LINE.work}{mmss ? ` · ${mmss}` : ''}
            </Text>
            <TextInput
              style={styles.caption}
              placeholder={t('challengeUpload.captionPh')}
              placeholderTextColor={palette.textFaint}
              value={caption}
              onChangeText={setCaption}
              multiline
            />
          </View>
        </View>

        <View style={styles.note}>
          <Feather name="zap" size={13} color={palette.blueDeep} />
          <Text style={styles.noteText}>{t('challengeUpload.note')}</Text>
        </View>

        <Option
          icon="globe"
          title={t('challengeUpload.optPublic')}
          sub={t('challengeUpload.optPublicSub')}
          selected={mode === 'public'}
          onPress={() => setMode('public')}
        />
        <Option
          icon="lock"
          title={t('challengeUpload.optPrivate')}
          sub={t('challengeUpload.optPrivateSub')}
          selected={mode === 'private'}
          onPress={() => setMode('private')}
        />

        <View style={styles.previewNote}>
          <Feather name="info" size={12} color={palette.textFaint} />
          <Text style={styles.previewNoteText}>{t('challengeUpload.previewNote')}</Text>
        </View>
      </KeyboardAwareScroll>

      <View style={styles.footer}>
        <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={submit} accessibilityRole="button">
          <Text style={styles.primaryText}>{t(mode === 'public' ? 'challengeUpload.submit' : 'challengeUpload.submitPrivate')}</Text>
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
  meta: { fontSize: 12.5, fontWeight: '700', color: palette.textMuted, marginBottom: 6 },
  caption: {
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 84,
    color: palette.text,
    fontSize: 14,
    fontWeight: '600',
    textAlignVertical: 'top',
  },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: palette.blueSoft, borderRadius: 12, padding: 12 },
  noteText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: palette.blueDeep, lineHeight: 18 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
  },
  optionOn: { borderColor: palette.blue, backgroundColor: palette.blueMist },
  optionIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  optionIconOn: { backgroundColor: palette.blueSoft },
  optionTitle: { fontSize: 15, fontWeight: '800', color: palette.textDim },
  optionTitleOn: { color: palette.text },
  optionSub: { fontSize: 12, fontWeight: '500', color: palette.textFaint, marginTop: 3 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: palette.checkOff, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: palette.blue, backgroundColor: palette.blue },
  radioDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFFFFF' },
  previewNote: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 4 },
  previewNoteText: { fontSize: 11.5, fontWeight: '600', color: palette.textFaint },
  footer: { padding: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: palette.borderSoft, backgroundColor: palette.bg },
  primary: { height: 52, borderRadius: 14, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  ghost: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 14, fontWeight: '800', color: palette.textDim },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  // 완료 화면은 가운데 정렬이라 버튼이 글자 폭으로 줄어든다 — 가로로 꽉 채운다.
  doneBtn: { alignSelf: 'stretch' },
  doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  doneTitle: { fontSize: 22, fontWeight: '900', color: palette.text },
  doneSub: { fontSize: 13.5, fontWeight: '600', color: palette.textDim, textAlign: 'center', marginBottom: 12 },
});
