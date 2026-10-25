import Feather from '@expo/vector-icons/Feather';
import { usePreventRemove } from '@react-navigation/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { File } from 'expo-file-system';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as DocumentPicker from 'expo-document-picker';

import { palette } from '@/constants/palette';
import { Image } from 'expo-image';
import { PrimaryButton } from '@/components/ui/buttons';
import { DialogButtons } from '@/components/ui/dialog';
import { ReadingStatus } from '@/components/ui/reading-status';
import { isSplitFailure } from '@/lib/reading/redesign-748';
import { Markdown } from '@/components/markdown';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { afterVoicesSaved, currentTutorial } from '@/lib/tutorial';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { api, type ConsentEntryDocument } from '@/lib/api';
import { TARGET } from '@/lib/spotlight-targets';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import {
  importAlert,
  retryFlags,
  runScriptImport,
  TITLE_MAX,
  scriptSplitDocument,
  uploadScriptFile,
  type ImportFlags,
  type ImportInput,
  type ImportProgress,
  type ImportStop,
  type PickedScriptFile,
  type ScriptImportDeps,
} from '@/lib/reading/script-import';
import {
  formatFileSize,
  initialScriptInput,
  pendingScript,
  scriptInputReducer,
  type ScriptTab,
} from '@/lib/reading/script-input';
import { loadIntoCurrent } from '@/lib/reading/store';
import { isMonologue } from '@/lib/reading/monologue';
import { isGroupCharacter } from '@/lib/reading/session-plan';
import { MonologueNameDialog } from '@/components/monologue-name-dialog';
import { SamplePickerBody, useSamplePicker } from '@/components/reading/sample-picker';
import { newRequestId } from '@/lib/request-id';
import { translate as t } from '@/lib/i18n';

/**
 * 대본 넣기(R2, reading.script). 「파일로 넣기 | 글로 붙여넣기」 탭 하나를 골라 [다음]을 누르면 서버가 나눠 바로
 * 저장하고, 그동안 R2.11 팝업에 진행 줄 수를 보인다. 파일은 고르는 순간 서버에 올려 글자를 뽑게 한다(R2.2).
 */
const MASCOT = require('@/assets/images/mascot-reading.png');
/** pen R2 「대본 읽는 액티」·「예시 대본 카드」 그림. */
const HERO_ACTY = require('@/assets/images/reading/acty-reading-hero.png');

const PICKER_TYPES = [
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
  'application/x-hwp',
  'application/haansofthwp',
  'application/vnd.hancom.hwp',
  'application/vnd.hancom.hwpx',
  'application/hwp+zip',
  // iOS 는 hwp·hwpx 형식을 모르면(한컴 앱이 없으면) 위 MIME 을 버리고, 안드로이드 파일 앱은 hwp 를 이 값으로 알린다.
  // 그래서 이 값으로 아무 파일이나 고르게 두고, 받지 않는 확장자는 서버가 거른다(R2.4).
  'application/octet-stream',
];

const DEPS: ScriptImportDeps = {
  import: {
    start: (body) => api.importScript(body),
    get: (id) => api.getScriptImport(id),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
  upload: {
    create: (body) => api.createScriptUpload(body),
    put: async (url, uri, contentType) => {
      const upload = await api.startUploadToUrl(url, uri, contentType).result;
      if (upload.kind !== 'uploaded') throw new Error('cancelled');
    },
    complete: (id) => api.completeScriptUpload(id),
  },
  newRequestId,
};

/** 동의 뒤 이어 할 일 — 멈춘 그 요청. 파일은 올리다가, 글은 나누다가 동의를 물었다. */
type Resume = { kind: 'import'; input: ImportInput; flags: ImportFlags } | { kind: 'upload'; file: PickedScriptFile };

/** R2 위 팝업 하나. iOS 는 닫히는 모달 위에 새 모달을 띄우지 못해 모든 장을 한 모달에 그린다. */
type Popup =
  | { kind: 'splitting'; progress: ImportProgress | null } // R2.11
  | { kind: 'alert'; title: string; message: string } // R2.4·R2.12·R2.13·R2.15
  /** pen 「대본을 못 나눴어요」 — 화면 전체로 보이고 [다시 시도]·[직접 붙여 넣기]를 준다. */
  | { kind: 'failed'; message: string; resume: Resume }
  /** flags 는 [새로 넣기]·[그래도 나누기]가 다시 보낼 때 붙일 것이다. */
  | { kind: 'duplicate'; title: string; input: ImportInput; flags: ImportFlags } // R2.7
  | { kind: 'not_script'; input: ImportInput; flags: ImportFlags } // R2.8
  | { kind: 'consent'; document: ConsentEntryDocument; resume: Resume; expanded: boolean; busy: boolean }; // R2.14

export default function ReadingNew() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  // 대본 리딩 튜토리얼의 예시(SOMA-494) — 예시 대본을 채운 채 연다.
  const sample = useLocalSearchParams<{ sample?: string }>().sample ?? '';
  const [input, dispatch] = useReducer(scriptInputReducer, sample, initialScriptInput);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [naming, setNaming] = useState<{ scriptId: string; characterId: string } | null>(null);
  // 배우가 적는 대본 제목(SOMA-669). 비우면 서버가 대본에서 찾아 붙인다.
  const [title, setTitle] = useState('');
  const pasteTabTarget = useSpotlightTarget(TARGET.readingDrop);
  const nextTarget = useSpotlightTarget(TARGET.readingNext);
  const tutorialGuide = useTutorialSpotlight('readingNew');
  const pending = pendingScript(input);
  // 화면을 떠나면 묻기를 멈추고, 떠난 뒤에 끝난 나누기가 다른 화면에서 router.replace 하지 않게 한다.
  const life = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    return () => controller.abort();
  }, []);

  // 대본을 다시 읽지 못한 것처럼 원인이 남지 않은 실패는 R2.12 공용 문구다.
  const failWith = (error?: unknown) =>
    setPopup({ kind: 'alert', title: t('common.save'), message: error === undefined ? t('errors.network') : scriptErrorMessage(error) });

  const showStop = async (stop: ImportStop, resume: Resume) => {
    const alert = importAlert(stop);
    if (alert && isSplitFailure(stop)) return setPopup({ kind: 'failed', message: alert.message, resume });
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
    const signal = life.current?.signal;
    setPopup({ kind: 'splitting', progress: null });
    let input = next;
    const result = await runScriptImport(
      next,
      flags,
      DEPS,
      (progress) => setPopup({ kind: 'splitting', progress }),
      (uploadId) => {
        if (next.kind === 'file') input = { ...next, uploadId };
        dispatch({ type: 'fileUploaded', uploadId });
      },
      signal,
    );
    if (result.kind === 'cancelled' || signal?.aborted) return;
    if (result.kind === 'file_unreadable' || result.kind === 'file_too_large') dispatch({ type: 'fileFailed' });
    if (result.kind !== 'saved') return showStop(result, { kind: 'import', input, flags });
    const saved = await loadIntoCurrent(result.scriptId);
    if (signal?.aborted) return;
    if (!saved) return failWith();
    setPopup(null);
    // 이름 없는 독백은 누구의 대사인지 이름부터 받는다(SOMA-597). 닫으면 대본 상세로.
    const solo = saved.characters.filter((c) => !isGroupCharacter(c));
    if (isMonologue(saved.characters) && solo[0].unnamed) return setNaming({ scriptId: saved.id, characterId: solo[0].id });
    // 목소리는 넣을 때 자동으로 정한다 — 바꾸기는 대본 상세 ⋯ 에서만(pen R2).
    router.replace('/reading/detail');
    if (afterVoicesSaved(true, currentTutorial()) === 'detail_then_range') router.push('/reading/range');
  };

  /** 올리고 읽힌 파일이면 [다음]이 보낼 입력을 돌려준다. 실패·읽기 자리 없음은 팝업을 띄우고 null. */
  const upload = async (file: PickedScriptFile): Promise<ImportInput | null> => {
    dispatch({ type: 'fileReading', file });
    const result = await uploadScriptFile(file, DEPS.upload);
    if (result.kind === 'uploaded') {
      dispatch({ type: 'fileUploaded', uploadId: result.uploadId });
      return { kind: 'file', file, uploadId: result.uploadId };
    }
    if (result.kind === 'unread') {
      dispatch({ type: 'fileUploaded', uploadId: result.uploadId });
      await showStop({ kind: 'busy' }, { kind: 'upload', file });
      return null;
    }
    dispatch({ type: 'fileFailed' });
    await showStop(result, { kind: 'upload', file });
    return null;
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
    // 버튼 이름대로 동의 → 올리기 → 나누기까지 잇는다.
    setPopup(null);
    const next = await upload(resume.file);
    if (next) await split(next, { title });
  };

  const retryFailed = async (resume: Resume) => {
    if (resume.kind === 'import') return split(resume.input, resume.flags);
    setPopup(null);
    const next = await upload(resume.file);
    if (next) await split(next, { title });
  };

  // 세 번째 선택지 「대본 같이 만들기」(10/25) — 화면을 넘기지 않고 아래에 「예시 대본 고르기 · 새 대본 만들기」를 펼친다.
  // 예시 대본은 그 아래에서 바로 고르고, 새 대본 만들기는 「다음」으로 대본 만들기(감정 고르기)로 간다.
  const [makeOpen, setMakeOpen] = useState(false);
  const [makeChoice, setMakeChoice] = useState<'sample' | 'make' | null>(null);
  const picker = useSamplePicker({
    onNeedName: setNaming,
    // 서버 예시를 못 받았을 때의 내장 예시 — 그 글을 글 붙여넣기 칸에 채워 기존 저장 흐름을 탄다.
    onLocal: (id) => {
      setMakeOpen(false);
      dispatch({ type: 'sample', id });
    },
  });
  const setTab = (tab: ScriptTab) => {
    setMakeOpen(false);
    dispatch({ type: 'tab', tab });
  };
  const closable = popup !== null && popup.kind !== 'splitting' && !(popup.kind === 'consent' && popup.busy);
  // 파일을 올리는 중·나누는 중에는 떠나지 못하게 한다 — 나가면 올리던 파일과 나누기가 버려진다(SOMA-664).
  // 머리 뒤로 버튼·안드로이드 뒤로 키는 막고, iOS 밀어서 나가기는 끈다.
  const working = input.file.kind === 'reading' || popup?.kind === 'splitting';
  usePreventRemove(working, () => undefined);

  if (popup?.kind === 'failed') {
    return (
      <ReadingStatus
        title={t('reading.splitFailTitle')}
        body={t('reading.splitFailBody')}
        note={popup.message}
        onBack={() => setPopup(null)}
        primary={{ label: t('reading.splitRetry'), onPress: () => void retryFailed(popup.resume) }}
        secondary={{
          label: t('reading.splitPasteInstead'),
          onPress: () => {
            setPopup(null);
            setTab('paste');
          },
        }}
      />
    );
  }

  // pen F4 「배역과 대사 찾는 중」 — 팝업이 아니라 전체 화면이다. 나누는 동안은 떠나지 못하므로 닫기(X)는 두지 않는다.
  if (popup?.kind === 'splitting') {
    return <SplittingScreen progress={popup.progress} topInset={insets.top} />;
  }

  return (
    <View style={[styles.root, { paddingBottom: keyboard }]}>
      <Stack.Screen options={{ gestureEnabled: !working }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* pen R2.1 「히어로」 — 대본 읽는 액티(128×100) 옆에 큰 제목과 한 줄 설명. */}
        <View style={styles.hero}>
          <Image source={HERO_ACTY} style={styles.heroActy} contentFit="contain" accessibilityIgnoresInvertColors />
          <View style={styles.heroText}>
            <Text style={styles.title}>{t('reading.newHeading')}</Text>
            <Text style={styles.heroSub}>{t('reading.newSub')}</Text>
          </View>
        </View>

        {/* 「사진」 탭(사진으로 대본 넣기)은 서버에 사진 출처가 없어 숨긴다(SOMA-748). */}
        <View style={styles.segment}>
          <SegmentTab icon="paperclip" label={t('reading.tabFile')} on={!makeOpen && input.tab === 'file'} onPress={() => setTab('file')} />
          <View ref={pasteTabTarget.ref} onLayout={pasteTabTarget.onLayout} style={styles.segmentSlot}>
            <SegmentTab icon="edit-3" label={t('reading.tabPaste')} on={!makeOpen && input.tab === 'paste'} onPress={() => setTab('paste')} />
          </View>
          {/* 세 번째 선택지 — 대본이 없으면 같이 만들기. 예시 대본도 여기서 고른다(10/25). */}
          <SegmentTab icon="message-circle" label={t('reading.entryCocreate')} on={makeOpen} onPress={() => setMakeOpen(true)} />
        </View>

        {makeOpen && (
          <View style={styles.makeArea}>
            {(['sample', 'make'] as const).map((key) => (
              <Pressable
                key={key}
                accessibilityRole="radio"
                accessibilityState={{ selected: makeChoice === key }}
                ph-label={`reading_new_make_${key}`}
                onPress={() => setMakeChoice(key)}
                style={[styles.choice, makeChoice === key && styles.choiceOn]}>
                <Text style={styles.choiceTitle}>{t(key === 'sample' ? 'scriptCocreate.startSample' : 'scriptCocreate.startMake')}</Text>
                <Text style={styles.choiceSub}>{t(key === 'sample' ? 'scriptCocreate.startSampleSub' : 'scriptCocreate.startMakeSub')}</Text>
              </Pressable>
            ))}
            {makeChoice === 'sample' && <SamplePickerBody list={picker.list} entry={picker.entry} pick={picker.pick} />}
          </View>
        )}

        {!makeOpen && input.tab === 'file' && (
          <Pressable
            style={[styles.dropzone, input.file.kind === 'empty' && styles.dropzoneEmpty]}
            onPress={onPickFile}
            disabled={input.file.kind === 'reading'}>
            {input.file.kind === 'empty' && (
              <>
                <View style={styles.uploadCircle}>
                  <Feather name="upload" size={26} color={palette.blue} />
                </View>
                <Text style={[styles.dropTitle, styles.dropTitleEmpty]}>{t('reading.attach')}</Text>
                <Text style={styles.dropSub}>{t('reading.attachHint')}</Text>
                <View style={styles.pickBtn}>
                  <Text style={styles.pickBtnText}>{t('reading.attachPick')}</Text>
                </View>
              </>
            )}
            {input.file.kind === 'reading' && (
              <>
                <Text style={styles.dropTitle}>{t('reading.attachReading')}</Text>
                <Text style={styles.dropSub} numberOfLines={1}>
                  {`${input.file.file.name} · ${formatFileSize(input.file.file.size)}`}
                </Text>
              </>
            )}
            {input.file.kind === 'ready' && (
              <>
                <Feather name="file-text" size={30} color={palette.blue} />
                <Text style={styles.dropTitle} numberOfLines={1}>{input.file.file.name}</Text>
                <Text style={styles.dropSub}>{formatFileSize(input.file.file.size)}</Text>
                <View style={styles.replace}>
                  <Feather name="refresh-cw" size={13} color={palette.blueDeep} />
                  <Text style={styles.replaceText}>{t('reading.replaceFile')}</Text>
                </View>
              </>
            )}
          </Pressable>
        )}

        {/* pen 「제목 입력」 — 라벨 위, 문서 아이콘이 든 흰 칸. 비우면 서버가 대본에서 찾아 붙인다(SOMA-669). */}
        {!makeOpen && (
        <View style={styles.titleField}>
          <Text style={styles.titleLabel}>{t('reading.newTitleLabel')}</Text>
          <View style={styles.titleBox}>
            <Feather name="file-text" size={18} color={palette.textFaint} />
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder={t('reading.newTitlePlaceholder')}
              placeholderTextColor={palette.textFaint}
              maxLength={TITLE_MAX}
              editable={!working}
              returnKeyType="done"
              accessibilityLabel={t('reading.newTitleLabel')}
            />
          </View>
        </View>
        )}

        {!makeOpen && input.tab === 'paste' && (
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

        {!makeOpen && (input.tab === 'paste' || input.file.kind !== 'empty') && (
          <Text style={styles.guide}>{input.tab === 'file' ? t('reading.newGuideFile') : t('reading.newGuidePaste')}</Text>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + 10 }]}>
        <View ref={nextTarget.ref} onLayout={nextTarget.onLayout}>
          {makeOpen ? (
            <PrimaryButton
              label={makeChoice === 'sample' ? t('reading.samplePickConfirm') : t('reading.next')}
              phLabel="reading_new_make_next"
              loading={makeChoice === 'sample' && picker.busy}
              disabled={!makeChoice}
              onPress={() =>
                makeChoice === 'sample'
                  ? picker.confirm()
                  : router.push({ pathname: '/script-cocreate', params: { mode: 'reading', start: 'make' } })
              }
            />
          ) : (
            <PrimaryButton
              label={t('reading.next')}
              onPress={() => pending && void split(pending, { title })}
              disabled={!pending || !!popup}
            />
          )}
        </View>
      </View>

      {picker.dialog}
      <MonologueNameDialog
        target={naming}
        onClose={() => {
          setNaming(null);
          router.replace('/reading/detail');
        }}
      />
      <Modal transparent statusBarTranslucent visible={!!popup} animationType="fade" onRequestClose={() => closable && setPopup(null)}>
        {/* 하단 시트를 쓰지 않는다(10/24 규칙) — 대본 나누기 동의도 가운데 팝업이다. */}
        <View style={styles.backdrop}>
          {popup?.kind === 'alert' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{popup.title}</Text>
              <Text style={styles.cardBody}>{popup.message}</Text>
              <PrimaryButton label={t('common.confirm')} onPress={() => setPopup(null)} style={styles.cardButton} />
            </View>
          )}
          {popup?.kind === 'duplicate' && (
            // pen 「이미 넣은 대본이에요」 — 세로 선택지 둘.
            <View style={[styles.card, styles.optionCard]}>
              <Text style={styles.optionTitle}>{t('reading.duplicateTitle')}</Text>
              <Text style={styles.optionGuide}>{t('reading.duplicateGuide')}</Text>
              <Text style={styles.optionName} numberOfLines={1}>{t('reading.duplicateName', { title: popup.title })}</Text>
              <Pressable
                style={({ pressed }) => [styles.optionRow, pressed && styles.optionPressed]}
                accessibilityRole="button"
                onPress={() => {
                  setPopup(null);
                  router.replace('/reading/detail');
                }}>
                <Text style={styles.optionText}>{t('reading.duplicateOpen')}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.optionRow, pressed && styles.optionPressed]}
                accessibilityRole="button"
                onPress={() => void split(popup.input, popup.flags)}>
                <Text style={styles.optionText}>{t('reading.duplicateNew')}</Text>
              </Pressable>
            </View>
          )}
          {popup?.kind === 'not_script' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('reading.notScriptTitle')}</Text>
              <Text style={styles.cardBody}>{t('reading.notScriptBody')}</Text>
              <DialogButtons
                cancelLabel={t('reading.notScriptSplit')}
                onCancel={() => void split(popup.input, popup.flags)}
                confirmLabel={t('reading.notScriptRepick')}
                onConfirm={() => setPopup(null)}
              />
            </View>
          )}
          {popup?.kind === 'consent' && (
            <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
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
              <PrimaryButton label={t('reading.consentAgree')} loading={popup.busy} onPress={() => void onAgree(popup)} style={styles.sheetButton} />
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

/** pen F4. 진행은 서버가 알려 주는 만큼만 — 줄 수를 세기 전에는 퍼센트 없이 제목만 보인다. */
function SplittingScreen({ progress, topInset }: { progress: ImportProgress | null; topInset: number }) {
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <View style={[styles.root, styles.splitScreen, { paddingTop: topInset + 120 }]}>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <Image source={MASCOT} style={styles.splitMascot} contentFit="contain" accessibilityIgnoresInvertColors />
      <Text style={styles.splitHeading}>{t('reading.splitTitle')}</Text>
      {total > 0 && <Text style={styles.splitProgress}>{t('reading.splitProgress', { pct, done, total })}</Text>}
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

function SegmentTab({ icon, label, on, onPress }: { icon: 'paperclip' | 'edit-3' | 'message-circle'; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentTab, on && styles.segmentTabOn]} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Feather name={icon} size={16} color={on ? palette.blue : palette.textMuted} />
      <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, gap: 14 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 114 },
  heroActy: { width: 128, height: 100 },
  heroText: { flex: 1, gap: 10 },
  title: { color: palette.text, fontSize: 24, fontWeight: '900', lineHeight: 32 },
  heroSub: { color: palette.textMuted, fontSize: 14, fontWeight: '500', lineHeight: 21 },
  titleField: { gap: 10 },
  titleLabel: { color: palette.textDim, fontSize: 14, fontWeight: '700' },
  titleBox: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, backgroundColor: palette.card, borderColor: '#E3E8EF', borderWidth: 1, borderRadius: 14, paddingHorizontal: 16 },
  titleInput: { flex: 1, color: palette.text, fontFamily: 'Pretendard', fontSize: 15, padding: 0 },
  segment: { flexDirection: 'row', backgroundColor: '#EEF2F8', borderRadius: 14, padding: 4 },
  segmentSlot: { flex: 1 },
  makeArea: { gap: 12 },
  choice: { gap: 4, padding: 18, borderRadius: 16, backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border },
  choiceOn: { backgroundColor: palette.bgSoft, borderColor: palette.blue },
  choiceTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  choiceSub: { fontSize: 13.5, fontWeight: '500', color: palette.textMuted },
  segmentTab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 10, height: 58, paddingHorizontal: 4 },
  segmentTabOn: { backgroundColor: palette.card },
  segmentText: { color: palette.textMuted, fontSize: 13, fontWeight: '700' },
  segmentTextOn: { color: palette.blue, fontWeight: '800' },
  dropzone: { minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20, borderRadius: 16 },
  // pen 「파일칸」 — 옅은 파랑 바탕, 점선 테두리(#BCD3F3), 모서리 22.
  dropzoneEmpty: { minHeight: 228, gap: 6, padding: 20, borderRadius: 22, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#BCD3F3', backgroundColor: '#F5F9FE' },
  uploadCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#E6EFFD', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  dropTitle: { color: palette.text, fontSize: 16, fontWeight: '800' },
  dropTitleEmpty: { fontSize: 17 },
  dropSub: { color: palette.textFaint, fontSize: 13, fontWeight: '500' },
  pickBtn: { marginTop: 8, backgroundColor: '#E3EDFD', borderRadius: 22, height: 44, paddingHorizontal: 32, justifyContent: 'center' },
  pickBtnText: { color: palette.blueDeep, fontSize: 15, fontWeight: '800' },
  replace: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, backgroundColor: palette.card, borderColor: palette.blueLine, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  replaceText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  textArea: { flex: 1, minHeight: 256, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14, color: palette.text, fontFamily: 'Pretendard', fontSize: 15, lineHeight: 22 },
  guide: { color: palette.blueDeep, fontSize: 13, fontWeight: '700', lineHeight: 20, textAlign: 'center' },
  footer: { paddingHorizontal: 24, paddingTop: 12, backgroundColor: palette.bg },
  backdrop: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 340, backgroundColor: palette.card, borderRadius: 22, paddingHorizontal: 22, paddingTop: 24, paddingBottom: 18, alignItems: 'center', gap: 10 },
  cardTitle: { color: palette.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  cardBody: { color: palette.textDim, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  cardButton: { alignSelf: 'stretch', marginTop: 12 },
  splitScreen: { paddingHorizontal: 24, gap: 14 },
  splitMascot: { width: 72, height: 80, marginBottom: 20 },
  splitHeading: { color: palette.text, fontSize: 28, fontWeight: '800', lineHeight: 38 },
  splitProgress: { color: palette.blue, fontSize: 17, fontWeight: '800' },
  optionCard: { alignItems: 'stretch', paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24, gap: 6 },
  optionTitle: { color: palette.text, fontSize: 20, fontWeight: '900', lineHeight: 28 },
  optionGuide: { color: palette.blueDeep, fontSize: 14, fontWeight: '700', lineHeight: 21 },
  optionName: { color: palette.textMuted, fontSize: 13, marginBottom: 6 },
  optionRow: { paddingVertical: 14, paddingHorizontal: 2, borderRadius: 10 },
  optionPressed: { backgroundColor: palette.bgSubtle },
  optionText: { color: palette.text, fontSize: 16, fontWeight: '700', lineHeight: 24 },
  sheet: { alignSelf: 'stretch', backgroundColor: palette.card, borderRadius: 22, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18 },
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
