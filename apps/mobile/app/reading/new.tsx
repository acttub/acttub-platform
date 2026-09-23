import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as DocumentPicker from 'expo-document-picker';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { PdfTextExtractor } from '@/components/pdf-text-extractor';
import { extractScriptText, scriptFileRejection } from '@/lib/reading/extract-file';
import { nextTextSource } from '@/lib/reading/file-input';
import { SAMPLE_SCRIPT } from '@/lib/reading/sample';
import { newDraft, setPendingDraft } from '@/lib/reading/store';
import type { ScriptSource } from '@/lib/reading/types';
import { translate as t } from '@/lib/i18n';

/**
 * 대본 넣기(R01, reading.script). 파일·붙여넣기·직접 쓰기·예시 네 길로 글을 받고, 확인 화면에서
 * 배역을 고친 뒤 저장한다. 파일은 글자만 뽑고 파일 자체는 서버에 올리지 않는다. 20,000,000바이트를
 * 넘는 파일과 hwp·hwpx 는 글자를 뽑기 전에 기기가 거른다.
 */
const PICKER_TYPES = [
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
  // hwp·hwpx 는 열지 못하지만 고를 수는 있게 두어 "미지원" 안내를 보여 준다.
  'application/x-hwp',
  'application/haansofthwp',
  'application/vnd.hancom.hwp',
  'application/hwp+zip',
];

export default function ReadingNew() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const { alert, dialog } = useAppDialog();
  // 입력 경로(file·paste·typed·sample)는 글이 어떻게 들어왔는지로 정한다(file-input).
  const sourceRef = useRef<ScriptSource | null>(null);
  const rawRef = useRef('');

  const onChangeText = (next: string) => {
    sourceRef.current = nextTextSource(sourceRef.current, rawRef.current, next);
    rawRef.current = next;
    setRaw(next);
  };
  const setFromOutside = (text: string, source: ScriptSource) => {
    sourceRef.current = source;
    rawRef.current = text;
    setRaw(text);
  };

  const onPickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: PICKER_TYPES, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const rejection = scriptFileRejection({ name: a.name, mimeType: a.mimeType, size: a.size });
      if (rejection) {
        void alert({ title: t('reading.readFail'), message: rejection });
        return;
      }
      setBusy(true);
      const text = await extractScriptText({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size });
      setFromOutside(text, 'file');
    } catch (e: any) {
      void alert({ title: t('reading.readFail'), message: e?.message ?? t('reading.readFailBody') });
    } finally {
      setBusy(false);
    }
  };

  const onNext = () => {
    const text = raw.trim();
    if (!text) return;
    // 배역이 안 잡혀도 확인 화면으로 간다 — 거기서 이름을 직접 적게 한다(예외 규칙).
    setPendingDraft(newDraft(text, sourceRef.current ?? 'typed'));
    router.push('/reading/confirm');
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

        <Pressable style={styles.sampleBtn} onPress={() => setFromOutside(SAMPLE_SCRIPT, 'sample')}>
          <Feather name="book" size={14} color={palette.blueDeep} />
          <Text style={styles.sampleText}>예시 대본 불러오기</Text>
        </Pressable>

        <TextInput
          style={styles.textArea}
          value={raw}
          onChangeText={onChangeText}
          multiline
          placeholder={t('reading.pastePlaceholder')}
          placeholderTextColor={palette.textFaint}
          textAlignVertical="top"
        />
        <View style={styles.noteRow}>
          <Feather name="lock" size={12} color={palette.textFaint} />
          <Text style={styles.note}>{t('reading.copyrightNote')}</Text>
        </View>
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
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 2 },
  note: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 12, flex: 1 },
  footer: { padding: 16, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  primary: { backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: palette.checkOff },
  primaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
});
