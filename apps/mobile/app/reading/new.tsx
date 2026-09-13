import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { parseScript } from '@/lib/reading/parse';
import { SAMPLE_SCRIPT } from '@/lib/reading/sample';
import { createFromParsed } from '@/lib/reading/store';

export default function ReadingNew() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [raw, setRaw] = useState('');
  const { alert, dialog } = useAppDialog();

  const onNext = async () => {
    const text = raw.trim();
    if (!text) return;
    const parsed = parseScript(text);
    if (parsed.roles.length < 1) {
      void alert({
        title: '배역을 찾지 못했어요',
        message: '"이름: 대사" 형식인지 확인해 주세요. 예시 대본을 참고할 수 있어요.',
      });
      return;
    }
    await createFromParsed(parsed);
    router.replace('/reading/roles');
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.step}>STEP 1 · 대본 넣기</Text>
        <Text style={styles.title}>연습할 대본을 넣어주세요</Text>
        <Text style={styles.sub}>대본을 붙여넣으면 화자와 대사를 자동으로 나눠드려요.</Text>

        {/* 파일 업로드 자리(다음 단계). 지금은 붙여넣기 + 예시. */}
        <View style={styles.dropzone}>
          <Feather name="file-plus" size={26} color={palette.blue} />
          <Text style={styles.dropTitle}>대본 붙여넣기</Text>
          <Text style={styles.dropSub}>아래 칸에 대본을 붙여넣어요 · 파일 업로드는 곧 지원돼요</Text>
        </View>

        <Pressable style={styles.sampleBtn} onPress={() => setRaw(SAMPLE_SCRIPT)}>
          <Feather name="book" size={14} color={palette.blueDeep} />
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
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
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
  content: { padding: 20, gap: 12 },
  step: { color: palette.blue, fontFamily: 'Pretendard-SemiBold', fontSize: 12, letterSpacing: 0.3 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 2 },
  sub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 20 },
  dropzone: { alignItems: 'center', gap: 6, backgroundColor: palette.blueMist, borderColor: palette.blueLine, borderWidth: 1, borderStyle: 'dashed', borderRadius: 16, paddingVertical: 26 },
  dropTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15, marginTop: 2 },
  dropSub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  sampleBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  sampleText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  textArea: { backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 200, color: palette.text, fontFamily: 'Pretendard', fontSize: 15, lineHeight: 22 },
  footer: { padding: 16, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  primary: { backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: palette.checkOff },
  primaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
});
