import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as DocumentPicker from 'expo-document-picker';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { PdfTextExtractor } from '@/components/pdf-text-extractor';
import { extractScriptText } from '@/lib/reading/extract-file';
import { parseScript } from '@/lib/reading/parse';
import { SAMPLE_SCRIPT } from '@/lib/reading/sample';
import { createFromParsed } from '@/lib/reading/store';
import { translate as t } from '@/lib/i18n';

export default function ReadingNew() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const { alert, dialog } = useAppDialog();

  const onPickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setBusy(true);
      const text = await extractScriptText({ uri: a.uri, name: a.name, mimeType: a.mimeType });
      setRaw(text);
    } catch (e: any) {
      void alert({ title: t('reading.readFail'), message: e?.message ?? t('reading.readFailBody') });
    } finally {
      setBusy(false);
    }
  };

  const onNext = async () => {
    const text = raw.trim();
    if (!text) return;
    const parsed = parseScript(text);
    if (parsed.roles.length < 1) {
      void alert({
        title: t('reading.noRoles'),
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

        <Pressable style={styles.dropzone} onPress={onPickFile} disabled={busy}>
          <Feather name={busy ? 'loader' : 'upload'} size={26} color={palette.blue} />
          <Text style={styles.dropTitle}>{busy ? t('reading.attachReading') : t('reading.attach')}</Text>
          <Text style={styles.dropSub}>TXT·DOCX·PDF 파일 선택 · 아래에 붙여넣어도 돼요</Text>
        </Pressable>

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
      <PdfTextExtractor />
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
