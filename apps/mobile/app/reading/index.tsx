import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/palette';
import { parseScript } from '@/lib/reading/parse';
import { SAMPLE_SCRIPT } from '@/lib/reading/sample';
import { setScript } from '@/lib/reading/session';
import { useAppDialog } from '@/components/app-dialog';

export default function ReadingInput() {
  const router = useRouter();
  const [raw, setRaw] = useState('');
  const { alert, dialog } = useAppDialog();

  const onNext = () => {
    const text = raw.trim();
    if (!text) {
      void alert({ title: '대본이 비어 있어요', message: '대본을 붙여넣거나 예시 대본을 불러와 주세요.' });
      return;
    }
    const parsed = parseScript(text);
    if (parsed.roles.length < 1) {
      void alert({
        title: '배역을 찾지 못했어요',
        message: '"이름: 대사" 형식으로 되어 있는지 확인해 주세요. 예시 대본을 참고할 수 있어요.',
      });
      return;
    }
    setScript(parsed);
    router.push('/reading/roles');
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.step}>STEP 1 · 대본 넣기</Text>
        <Text style={styles.title}>연습할 대본을 넣어주세요</Text>
        <Text style={styles.sub}>대본을 붙여넣으면 화자와 대사를 자동으로 나눠드려요. 형식이 궁금하면 예시 대본을 불러와 보세요.</Text>

        <Pressable style={styles.sampleBtn} onPress={() => setRaw(SAMPLE_SCRIPT)}>
          <Text style={styles.sampleText}>예시 대본 불러오기</Text>
        </Pressable>

        <TextInput
          style={styles.textArea}
          value={raw}
          onChangeText={setRaw}
          multiline
          placeholder={'예)\n윤서: 여기 있을 줄 알았어.\n태오: 어떻게 알았어.'}
          placeholderTextColor={palette.textFaint}
          textAlignVertical="top"
        />

        <Text style={styles.note}>PDF·파일 업로드는 곧 지원돼요.</Text>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={[styles.primary, !raw.trim() && styles.primaryOff]} onPress={onNext} disabled={!raw.trim()}>
          <Text style={styles.primaryText}>다음</Text>
        </Pressable>
      </View>
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  content: { padding: 20, gap: 10 },
  step: { color: palette.blue, fontFamily: 'Pretendard-SemiBold', fontSize: 12, letterSpacing: 0.3 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 2 },
  sub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 20, marginBottom: 6 },
  sampleBtn: { alignSelf: 'flex-start', backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  sampleText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  textArea: {
    backgroundColor: palette.bgSubtle,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    minHeight: 240,
    color: palette.text,
    fontFamily: 'Pretendard',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 6,
  },
  note: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 12, marginTop: 4 },
  footer: { padding: 16, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  primary: { backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: palette.checkOff },
  primaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
});
