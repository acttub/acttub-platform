import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as DocumentPicker from 'expo-document-picker';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { PdfTextExtractor } from '@/components/pdf-text-extractor';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { TARGET } from '@/lib/spotlight-targets';
import { extractScriptText, scriptFileRejection } from '@/lib/reading/extract-file';
import { validateDraft, type ScriptDraft } from '@/lib/reading/script-draft';
import { scriptSaveAlert } from '@/lib/reading/script-errors';
import {
  fileMeta,
  formatFileSize,
  initialScriptInput,
  pendingScript,
  sameDraft,
  scriptInputReducer,
  showsSampleLink,
  type ScriptTab,
} from '@/lib/reading/script-input';
import { newDraft, saveDraft } from '@/lib/reading/store';
import { translate as t } from '@/lib/i18n';

/**
 * 대본 넣기(R2, reading.script). 「파일로 넣기 | 글로 붙여넣기」 탭 하나를 골라 글을 받고, [다음]을 누르면
 * 나누는 중 팝업(R2.11) 위에서 나누자마자 저장한다. 파일은 글자만 뽑고 파일 자체는 서버에 올리지 않는다.
 * 20,000,000바이트를 넘는 파일과 hwp·hwpx 는 글자를 뽑기 전에 기기가 거른다.
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

/**
 * [다음] 뒤 팝업 하나의 단계. 실패 알림도 같은 팝업에 그린다 — iOS 는 닫히는 모달 위에 새 모달을 띄우지 못한다.
 * 진행은 실제로 아는 만큼만이다. 휴대폰 파서는 한 번에 끝나므로 나눈 뒤 "N / N줄"이고, 서버가 진행을 알려 주게 되면
 * splitting 에 그 값을 넣는다.
 */
type Split =
  | { kind: 'splitting' }
  | { kind: 'saving'; lines: number }
  | { kind: 'failed'; title: string; message: string };

/** 팝업이 그려진 다음에 파서를 돌린다 — 파서가 JS 스레드를 잡고 있는 동안 화면이 멈춰 있지 않게. */
const afterPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

export default function ReadingNew() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  // 대본 리딩 튜토리얼의 예시(SOMA-494) — 예시 대본을 채운 채 연다.
  const sample = useLocalSearchParams<{ sample?: string }>().sample === '1';
  const [input, dispatch] = useReducer(scriptInputReducer, sample, initialScriptInput);
  const [split, setSplit] = useState<Split | null>(null);
  const draftRef = useRef<ScriptDraft | null>(null);
  const pasteTabTarget = useSpotlightTarget(TARGET.readingDrop);
  const nextTarget = useSpotlightTarget(TARGET.readingNext);
  const tutorialGuide = useTutorialSpotlight('readingNew');
  const { alert, dialog } = useAppDialog();
  const pending = pendingScript(input);

  const onPickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: PICKER_TYPES, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      dispatch({ type: 'fileReading', name: a.name, size: a.size ?? null });
      const rejection = scriptFileRejection({ name: a.name, mimeType: a.mimeType, size: a.size });
      if (rejection) {
        dispatch({ type: 'fileFailed' });
        void alert({ title: t('reading.readFail'), message: rejection });
        return;
      }
      const text = await extractScriptText({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size });
      dispatch({ type: 'fileRead', text });
    } catch (e: any) {
      dispatch({ type: 'fileFailed' });
      void alert({ title: t('reading.readFail'), message: e?.message ?? t('reading.readFailBody') });
    }
  };

  const onNext = async () => {
    if (!pending || split) return;
    if (!sameDraft(draftRef.current, pending)) draftRef.current = newDraft(pending.text, pending.source);
    const draft = draftRef.current;
    setSplit({ kind: 'splitting' });
    await afterPaint();
    const checked = validateDraft(draft);
    if (!checked.ok) {
      setSplit({ kind: 'failed', ...scriptSaveAlert(checked.code) });
      return;
    }
    setSplit({ kind: 'saving', lines: checked.body.lines.length });
    try {
      const saved = await saveDraft(draft);
      setSplit(null);
      if (saved.characters.length >= 2) router.replace({ pathname: '/reading/roles', params: { from: 'new' } });
      else router.replace('/reading/detail');
    } catch (e) {
      setSplit({ kind: 'failed', ...scriptSaveAlert(e) });
    }
  };

  const setTab = (tab: ScriptTab) => dispatch({ type: 'tab', tab });

  return (
    <View style={[styles.root, { paddingBottom: keyboard }]}>
      <View style={styles.content}>
        <Text style={styles.step}>{t('reading.newStep')}</Text>
        <Text style={styles.title}>{t('reading.newHeading')}</Text>
        <Text style={styles.sub}>{t('reading.newSub')}</Text>

        <View style={styles.segment}>
          <SegmentTab icon="paperclip" label={t('reading.tabFile')} on={input.tab === 'file'} onPress={() => setTab('file')} />
          <View ref={pasteTabTarget.ref} onLayout={pasteTabTarget.onLayout} style={styles.segmentSlot}>
            <SegmentTab icon="edit-3" label={t('reading.tabPaste')} on={input.tab === 'paste'} onPress={() => setTab('paste')} />
          </View>
        </View>

        {input.tab === 'file' ? (
          <Pressable style={styles.dropzone} onPress={onPickFile} disabled={input.file.kind === 'reading'}>
            {input.file.kind === 'empty' && (
              <>
                <Feather name="upload" size={26} color={palette.blue} />
                <Text style={styles.dropTitle}>{t('reading.attach')}</Text>
                <Text style={styles.dropSub}>{t('reading.attachHint')}</Text>
              </>
            )}
            {input.file.kind === 'reading' && (
              <>
                <ActivityIndicator color={palette.blue} />
                <Text style={styles.dropTitle}>{t('reading.attachReading')}</Text>
                <Text style={styles.dropSub} numberOfLines={1}>
                  {input.file.size === null ? input.file.name : `${input.file.name} · ${formatFileSize(input.file.size)}`}
                </Text>
              </>
            )}
            {input.file.kind === 'ready' && (
              <>
                <Feather name="file-text" size={26} color={palette.blue} />
                <Text style={styles.dropTitle} numberOfLines={1}>{input.file.name}</Text>
                <Text style={styles.dropSub}>{fileMeta(input.file)}</Text>
                <View style={styles.replace}>
                  <Feather name="refresh-cw" size={13} color={palette.blueDeep} />
                  <Text style={styles.replaceText}>{t('reading.replaceFile')}</Text>
                </View>
              </>
            )}
          </Pressable>
        ) : (
          <TextInput
            style={styles.textArea}
            value={input.paste.text}
            onChangeText={(text) => dispatch({ type: 'paste', text })}
            multiline
            placeholder={t('reading.pastePlaceholder')}
            placeholderTextColor={palette.textFaint}
            textAlignVertical="top"
          />
        )}

        {input.tab === 'file' && <View style={styles.spacer} />}
        {showsSampleLink(input) && (
          <Pressable style={styles.sampleLink} hitSlop={8} onPress={() => dispatch({ type: 'sample' })}>
            <Text style={styles.sampleText}>{t('reading.sampleLink')}</Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + 12 }]}>
        <Pressable
          ref={nextTarget.ref}
          onLayout={nextTarget.onLayout}
          style={[styles.primary, !pending && styles.primaryOff]}
          onPress={onNext}
          disabled={!pending || !!split}>
          <Text style={styles.primaryText}>{t('reading.next')}</Text>
        </Pressable>
      </View>

      <Modal transparent statusBarTranslucent visible={!!split} animationType="fade" onRequestClose={() => split?.kind === 'failed' && setSplit(null)}>
        <View style={styles.backdrop}>
          {split?.kind === 'failed' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{split.title}</Text>
              <Text style={styles.cardBody}>{split.message}</Text>
              <Pressable style={[styles.primary, styles.cardButton]} onPress={() => setSplit(null)}>
                <Text style={styles.primaryText}>{t('common.confirm')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={[styles.card, styles.splitCard]}>
              <View style={styles.splitIcon}>
                <ActivityIndicator color={palette.blue} />
              </View>
              <Text style={styles.cardTitle}>{t('reading.splitTitle')}</Text>
              <Text style={styles.cardBody}>{split?.kind === 'saving' ? t('reading.splitSaving') : t('reading.splitBody')}</Text>
              {split?.kind === 'saving' && (
                <>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, styles.barFull]} />
                  </View>
                  <Text style={styles.splitCount}>{t('reading.splitLines', { done: split.lines, total: split.lines })}</Text>
                </>
              )}
            </View>
          )}
        </View>
      </Modal>
      <PdfTextExtractor />
      {dialog}
      {tutorialGuide.element}
    </View>
  );
}

function SegmentTab({ icon, label, on, onPress }: { icon: 'paperclip' | 'edit-3'; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentTab, on && styles.segmentTabOn]} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Feather name={icon} size={14} color={on ? palette.text : palette.textMuted} />
      <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  content: { flex: 1, padding: 20, gap: 12 },
  step: { color: palette.blue, fontFamily: 'Pretendard-SemiBold', fontSize: 12, letterSpacing: 0.3 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 2 },
  sub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 20 },
  segment: { flexDirection: 'row', backgroundColor: palette.bgSoft, borderRadius: 12, padding: 4, marginTop: 4 },
  segmentSlot: { flex: 1 },
  segmentTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 9, paddingVertical: 10 },
  segmentTabOn: { backgroundColor: palette.card, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  segmentTextOn: { color: palette.text, fontFamily: 'Pretendard-Bold' },
  dropzone: { height: 190, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 20, backgroundColor: palette.blueMist, borderColor: palette.blueLine, borderWidth: 1, borderRadius: 16 },
  dropTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15, marginTop: 4 },
  dropSub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  replace: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, backgroundColor: palette.card, borderColor: palette.blueLine, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  replaceText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  textArea: { flex: 1, backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14, color: palette.text, fontFamily: 'Pretendard', fontSize: 15, lineHeight: 22 },
  spacer: { flex: 1 },
  sampleLink: { alignSelf: 'center', paddingVertical: 4 },
  sampleText: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, textDecorationLine: 'underline' },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  primary: { backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: palette.checkOff },
  primaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  backdrop: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 340, backgroundColor: palette.card, borderRadius: 22, paddingHorizontal: 22, paddingTop: 24, paddingBottom: 18, alignItems: 'center', gap: 10 },
  cardTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 17, textAlign: 'center' },
  cardBody: { color: palette.textDim, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  cardButton: { alignSelf: 'stretch', marginTop: 12 },
  splitCard: { paddingBottom: 24, gap: 8 },
  splitIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  bar: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: palette.bgSoft, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: palette.blue },
  barFull: { width: '100%' },
  splitCount: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
});
