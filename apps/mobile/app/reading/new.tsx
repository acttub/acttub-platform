import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { File } from 'expo-file-system';
import { useReducer, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as DocumentPicker from 'expo-document-picker';

import { palette } from '@/constants/palette';
import { Markdown } from '@/components/markdown';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { api, type ConsentEntryDocument } from '@/lib/api';
import { TARGET } from '@/lib/spotlight-targets';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import {
  importAlert,
  importBody,
  retryFlags,
  runImport,
  scriptSplitDocument,
  uploadScriptFile,
  type ImportDeps,
  type ImportFlags,
  type ImportInput,
  type ImportProgress,
  type ImportStop,
  type PickedScriptFile,
  type UploadDeps,
} from '@/lib/reading/script-import';
import {
  formatFileSize,
  initialScriptInput,
  pendingScript,
  scriptInputReducer,
  showsSampleLink,
  type ScriptTab,
} from '@/lib/reading/script-input';
import { loadIntoCurrent } from '@/lib/reading/store';
import { newRequestId } from '@/lib/request-id';
import { translate as t } from '@/lib/i18n';

/**
 * 대본 넣기(R2, reading.script). 「파일로 넣기 | 글로 붙여넣기」 탭 하나를 골라 [다음]을 누르면 서버가 나눠 바로
 * 저장하고, 그동안 R2.11 팝업에 진행 줄 수를 보인다. 파일은 고르는 순간 서버에 올려 글자를 뽑게 한다(R2.2).
 */
const PICKER_TYPES = [
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
  'application/x-hwp',
  'application/haansofthwp',
  'application/vnd.hancom.hwp',
  'application/hwp+zip',
];

const IMPORT_DEPS: ImportDeps = {
  start: (body) => api.importScript(body),
  get: (id) => api.getScriptImport(id),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const UPLOAD_DEPS: UploadDeps = {
  create: (body) => api.createScriptUpload(body),
  put: async (url, uri, contentType) => {
    const upload = await api.startUploadToUrl(url, uri, contentType).result;
    if (upload.kind !== 'uploaded') throw new Error(t('errors.network'));
  },
  complete: (id) => api.completeScriptUpload(id),
};

/** 동의 뒤 이어 할 일 — 멈춘 그 요청. 파일은 올리다가, 글은 나누다가 동의를 물었다. */
type Resume = { kind: 'import'; input: ImportInput; flags: ImportFlags } | { kind: 'upload'; file: PickedScriptFile };

/** R2 위 팝업 하나. iOS 는 닫히는 모달 위에 새 모달을 띄우지 못해 모든 장을 한 모달에 그린다. */
type Popup =
  | { kind: 'splitting'; progress: ImportProgress | null } // R2.11
  | { kind: 'alert'; title: string; message: string } // R2.4·R2.12·R2.13·R2.15
  /** flags 는 [새로 넣기]·[그래도 나누기]가 다시 보낼 때 붙일 것이다. */
  | { kind: 'duplicate'; title: string; input: ImportInput; flags: ImportFlags } // R2.7
  | { kind: 'not_script'; input: ImportInput; flags: ImportFlags } // R2.8
  | { kind: 'consent'; document: ConsentEntryDocument; resume: Resume; expanded: boolean; busy: boolean }; // R2.14

export default function ReadingNew() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  // 대본 리딩 튜토리얼의 예시(SOMA-494) — 예시 대본을 채운 채 연다.
  const sample = useLocalSearchParams<{ sample?: string }>().sample === '1';
  const [input, dispatch] = useReducer(scriptInputReducer, sample, initialScriptInput);
  const [popup, setPopup] = useState<Popup | null>(null);
  const pasteTabTarget = useSpotlightTarget(TARGET.readingDrop);
  const nextTarget = useSpotlightTarget(TARGET.readingNext);
  const tutorialGuide = useTutorialSpotlight('readingNew');
  const pending = pendingScript(input);

  // 대본을 다시 읽지 못한 것처럼 원인이 남지 않은 실패는 R2.12 공용 문구다.
  const failWith = (error?: unknown) =>
    setPopup({ kind: 'alert', title: t('common.save'), message: error === undefined ? t('errors.network') : scriptErrorMessage(error) });

  const showStop = async (stop: ImportStop, resume: Resume) => {
    const alert = importAlert(stop);
    if (alert) return setPopup({ kind: 'alert', ...alert });
    if (stop.kind === 'consent') {
      try {
        const document = scriptSplitDocument((await api.consentEntry()).documents);
        // 법무 문서가 발행되기 전에는 동의할 문서가 없어 넣을 수 없다.
        if (!document) return setPopup({ kind: 'alert', title: t('common.save'), message: t('errors.forbidden') });
        return setPopup({ kind: 'consent', document, resume, expanded: false, busy: false });
      } catch (error) {
        return failWith(error);
      }
    }
    if (resume.kind !== 'import') return setPopup(null);
    const flags = { ...resume.flags, ...retryFlags(stop) };
    if (stop.kind === 'not_script') return setPopup({ kind: 'not_script', input: resume.input, flags });
    if (stop.kind === 'duplicate') {
      const existing = await loadIntoCurrent(stop.scriptId);
      if (!existing) return failWith();
      setPopup({ kind: 'duplicate', title: existing.title, input: resume.input, flags });
    }
  };

  const split = async (next: ImportInput, flags: ImportFlags) => {
    setPopup({ kind: 'splitting', progress: null });
    const result = await runImport(importBody(next, flags, newRequestId()), IMPORT_DEPS, (progress) =>
      setPopup({ kind: 'splitting', progress }),
    );
    if (result.kind !== 'saved') return showStop(result, { kind: 'import', input: next, flags });
    const saved = await loadIntoCurrent(result.scriptId);
    if (!saved) return failWith();
    setPopup(null);
    if (saved.characters.length >= 2) router.replace({ pathname: '/reading/roles', params: { from: 'new' } });
    else router.replace('/reading/detail');
  };

  const upload = async (file: PickedScriptFile) => {
    dispatch({ type: 'fileReading', name: file.name, size: file.size });
    const result = await uploadScriptFile(file, UPLOAD_DEPS);
    if (result.kind === 'uploaded') return dispatch({ type: 'fileRead', uploadId: result.uploadId });
    dispatch({ type: 'fileFailed' });
    await showStop(result, { kind: 'upload', file });
  };

  const onPickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: PICKER_TYPES, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      await upload({ uri: a.uri, name: a.name, size: a.size ?? new File(a.uri).size });
    } catch (error) {
      dispatch({ type: 'fileFailed' });
      failWith(error);
    }
  };

  const onAgree = async (consent: Extract<Popup, { kind: 'consent' }>) => {
    setPopup({ ...consent, busy: true });
    try {
      await api.recordConsent(consent.document.id, 'granted');
    } catch (error) {
      return failWith(error);
    }
    const { resume } = consent;
    if (resume.kind === 'import') return split(resume.input, resume.flags);
    setPopup(null);
    await upload(resume.file);
  };

  const setTab = (tab: ScriptTab) => dispatch({ type: 'tab', tab });
  const closable = popup !== null && popup.kind !== 'splitting' && !(popup.kind === 'consent' && popup.busy);

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
                  {`${input.file.name} · ${formatFileSize(input.file.size)}`}
                </Text>
              </>
            )}
            {input.file.kind === 'ready' && (
              <>
                <Feather name="file-text" size={26} color={palette.blue} />
                <Text style={styles.dropTitle} numberOfLines={1}>{input.file.name}</Text>
                <Text style={styles.dropSub}>{formatFileSize(input.file.size)}</Text>
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
          onPress={() => pending && void split(pending, {})}
          disabled={!pending || !!popup}>
          <Text style={styles.primaryText}>{t('reading.next')}</Text>
        </Pressable>
      </View>

      <Modal transparent statusBarTranslucent visible={!!popup} animationType="fade" onRequestClose={() => closable && setPopup(null)}>
        <View style={[styles.backdrop, popup?.kind === 'consent' && styles.backdropSheet]}>
          {popup?.kind === 'splitting' && <SplittingCard progress={popup.progress} />}
          {popup?.kind === 'alert' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{popup.title}</Text>
              <Text style={styles.cardBody}>{popup.message}</Text>
              <Pressable style={[styles.primary, styles.cardButton]} onPress={() => setPopup(null)}>
                <Text style={styles.primaryText}>{t('common.confirm')}</Text>
              </Pressable>
            </View>
          )}
          {popup?.kind === 'duplicate' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('reading.duplicateTitle')}</Text>
              <Text style={styles.cardBody}>{`${t('reading.duplicateBody')}\n${t('reading.duplicateName', { title: popup.title })}`}</Text>
              <ChoiceRow
                secondary={t('reading.duplicateNew')}
                onSecondary={() => void split(popup.input, popup.flags)}
                primary={t('reading.duplicateOpen')}
                onPrimary={() => {
                  setPopup(null);
                  router.replace('/reading/detail');
                }}
              />
            </View>
          )}
          {popup?.kind === 'not_script' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('reading.notScriptTitle')}</Text>
              <Text style={styles.cardBody}>{t('reading.notScriptBody')}</Text>
              <ChoiceRow
                secondary={t('reading.notScriptSplit')}
                onSecondary={() => void split(popup.input, popup.flags)}
                primary={t('reading.notScriptRepick')}
                onPrimary={() => setPopup(null)}
              />
            </View>
          )}
          {popup?.kind === 'consent' && (
            <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{t('reading.consentTitle')}</Text>
              <Text style={styles.sheetSub}>{t('reading.consentSub')}</Text>
              <View style={styles.sheetPoints}>
                <SheetPoint icon="send" text={t('reading.consentSend')} />
                <SheetPoint icon="archive" text={t('reading.consentKeep')} />
              </View>
              <Pressable style={styles.more} hitSlop={8} onPress={() => setPopup({ ...popup, expanded: !popup.expanded })}>
                <Text style={styles.moreText}>{t('reading.consentMore')}</Text>
                <Feather name={popup.expanded ? 'chevron-down' : 'chevron-right'} size={15} color={palette.textDim} />
              </Pressable>
              {popup.expanded && (
                <ScrollView style={styles.docBody}>
                  <Markdown source={popup.document.body} />
                </ScrollView>
              )}
              <Pressable style={[styles.primary, styles.sheetButton]} disabled={popup.busy} onPress={() => void onAgree(popup)}>
                {popup.busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{t('reading.consentAgree')}</Text>}
              </Pressable>
              <Pressable style={styles.sheetCancel} disabled={popup.busy} onPress={() => setPopup(null)}>
                <Text style={styles.sheetCancelText}>{t('common.cancel')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>
      {tutorialGuide.element}
    </View>
  );
}

/** R2.11. 진행은 서버가 알려 주는 만큼만 — 줄 수를 세기 전에는 막대만 비어 있다. */
function SplittingCard({ progress }: { progress: ImportProgress | null }) {
  const total = progress?.total ?? 0;
  const ratio = total > 0 ? Math.min(1, (progress?.done ?? 0) / total) : 0;
  return (
    <View style={[styles.card, styles.splitCard]}>
      <View style={styles.splitIcon}>
        <ActivityIndicator color={palette.blue} />
      </View>
      <Text style={styles.cardTitle}>{t('reading.splitTitle')}</Text>
      <Text style={styles.cardBody}>{t('reading.splitBody')}</Text>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${ratio * 100}%` }]} />
      </View>
      {total > 0 && <Text style={styles.splitCount}>{t('reading.splitLines', { done: progress?.done ?? 0, total })}</Text>}
    </View>
  );
}

function ChoiceRow(props: { secondary: string; onSecondary: () => void; primary: string; onPrimary: () => void }) {
  return (
    <View style={styles.choiceRow}>
      <Pressable style={[styles.choice, styles.choiceSecondary]} onPress={props.onSecondary}>
        <Text style={styles.choiceSecondaryText}>{props.secondary}</Text>
      </Pressable>
      <Pressable style={[styles.choice, styles.choicePrimary]} onPress={props.onPrimary}>
        <Text style={styles.primaryText}>{props.primary}</Text>
      </Pressable>
    </View>
  );
}

function SheetPoint({ icon, text }: { icon: 'send' | 'archive'; text: string }) {
  return (
    <View style={styles.point}>
      <Feather name={icon} size={16} color={palette.blue} style={styles.pointIcon} />
      <Text style={styles.pointText}>{text}</Text>
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
  backdropSheet: { justifyContent: 'flex-end', padding: 0 },
  card: { width: '100%', maxWidth: 340, backgroundColor: palette.card, borderRadius: 22, paddingHorizontal: 22, paddingTop: 24, paddingBottom: 18, alignItems: 'center', gap: 10 },
  cardTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 17, textAlign: 'center' },
  cardBody: { color: palette.textDim, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  cardButton: { alignSelf: 'stretch', marginTop: 12 },
  choiceRow: { alignSelf: 'stretch', flexDirection: 'row', gap: 8, marginTop: 12 },
  choice: { flex: 1, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  choiceSecondary: { backgroundColor: palette.bgSoft },
  choicePrimary: { backgroundColor: palette.blue },
  choiceSecondaryText: { color: palette.textStrong, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  splitCard: { paddingBottom: 24, gap: 8 },
  splitIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  bar: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: palette.bgSoft, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: palette.blue },
  splitCount: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  sheet: { alignSelf: 'stretch', backgroundColor: palette.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 18 },
  sheetTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 18 },
  sheetSub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, marginTop: 4 },
  sheetPoints: { gap: 12, marginTop: 20 },
  point: { flexDirection: 'row', gap: 10 },
  pointIcon: { marginTop: 2 },
  pointText: { flex: 1, color: palette.textStrong, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 21 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginTop: 16 },
  moreText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  docBody: { maxHeight: 220, marginTop: 10, backgroundColor: palette.bgSubtle, borderRadius: 12, padding: 12 },
  sheetButton: { marginTop: 22 },
  sheetCancel: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  sheetCancelText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 15 },
});
