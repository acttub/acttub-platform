import Feather from '@expo/vector-icons/Feather';
import { usePreventRemove } from '@react-navigation/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { File } from 'expo-file-system';
import { useEffect, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import * as DocumentPicker from 'expo-document-picker';

import { AdSlot } from '@/components/ad-slot';
import { KeyboardLift } from '@/components/keyboard-lift';
import { palette } from '@/constants/palette';
import { Image } from 'expo-image';
import { Button, PrimaryButton, TextButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { DialogButtons, DialogCard } from '@/components/ui/dialog';
import { InfoBanner } from '@/components/ui/info-banner';
import { MASCOT_SIZE } from '@/components/ui/mascot';
import { ReadingStatus } from '@/components/ui/reading-status';
import { SelectCard } from '@/components/ui/select-card';
import { TextField } from '@/components/ui/text-field';
import { isSplitFailure } from '@/lib/reading/redesign-748';
import { useWaitExit } from '@/hooks/use-wait-exit';
import { radius, space, type } from '@/constants/tokens';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { afterVoicesSaved, currentTutorial } from '@/lib/tutorial';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { api } from '@/lib/api';
import { TARGET } from '@/lib/spotlight-targets';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import {
  importAlert,
  retryFlags,
  runScriptImport,
  TITLE_MAX,
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
import { deleteScript, listScripts, loadIntoCurrent } from '@/lib/reading/store';
import { isMonologue } from '@/lib/reading/monologue';
import { isGroupCharacter } from '@/lib/reading/session-plan';
import { MonologueNameDialog } from '@/components/monologue-name-dialog';
import { ProSheetCard } from '@/components/pro-ui';
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
  /** pen WLdNc 「무료는 대본 3개까지 보관해요」(SOMA-818) — 서버가 403 free_script_limit 을 줄 때만. */
  | { kind: 'free_limit'; resume: Resume; busy: boolean }
  /** 보관한 대본이 둘 이상이면 지울 대본을 먼저 고른다(무료 3개). */
  | { kind: 'free_pick'; resume: Resume; scripts: { id: string; title: string }[] }
  /** pen K7q5Vk 「지금 대본과 바꾸기」 확인 — 지우면 그 대본의 연습 기록도 함께 지워진다. */
  | { kind: 'free_replace'; resume: Resume; scriptId: string; title: string; busy: boolean };

export default function ReadingNew() {
  const router = useRouter();
  // 대본 리딩 튜토리얼의 예시(SOMA-494) — 예시 대본을 채운 채 연다.
  const sample = useLocalSearchParams<{ sample?: string }>().sample ?? '';
  const [input, dispatch] = useReducer(scriptInputReducer, sample, initialScriptInput);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [naming, setNaming] = useState<{ scriptId: string; characterId: string } | null>(null);
  const title = input.title[input.tab];
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

  const failWith = (error: unknown) =>
    setPopup({ kind: 'alert', title: t('reading.importFailTitle'), message: scriptErrorMessage(error) });
  const failToOpen = () => setPopup({ kind: 'alert', title: t('reading.openFailTitle'), message: t('errors.network') });

  const showStop = async (stop: ImportStop, resume: Resume) => {
    const alert = importAlert(stop);
    if (alert && isSplitFailure(stop)) return setPopup({ kind: 'failed', message: alert.message, resume });
    if (alert) return setPopup({ kind: 'alert', ...alert });
    if (stop.kind === 'free_limit') return setPopup({ kind: 'free_limit', resume, busy: false });
    if (resume.kind !== 'import') return setPopup(null);
    const flags = { ...resume.flags, ...retryFlags(stop) };
    if (stop.kind === 'not_script') return setPopup({ kind: 'not_script', input: resume.input, flags });
    if (stop.kind === 'duplicate') {
      const existing = await loadIntoCurrent(stop.scriptId);
      if (!existing) return failToOpen();
      setPopup({ kind: 'duplicate', title: existing.title, input: resume.input, flags });
    }
  };

  // 「대본 하나 지우고 넣기」 — 보관 중인 대본(무료는 3개까지)을 읽는다. 하나면 바로 확인을 묻고, 둘 이상이면 지울 대본을 고르게 한다.
  const askReplace = async (resume: Resume) => {
    setPopup({ kind: 'free_limit', resume, busy: true });
    try {
      const scripts = (await listScripts()).scripts.map(({ id, title }) => ({ id, title }));
      if (scripts.length === 0) return setPopup(null);
      if (scripts.length === 1) return setPopup({ kind: 'free_replace', resume, scriptId: scripts[0].id, title: scripts[0].title, busy: false });
      setPopup({ kind: 'free_pick', resume, scripts });
    } catch (error) {
      failWith(error);
    }
  };

  // 지우고 새 대본 넣기 — 지운 뒤 같은 입력으로 다시 나눈다.
  const replaceAndRetry = async (popup: { resume: Resume; scriptId: string; title: string }) => {
    setPopup({ kind: 'free_replace', ...popup, busy: true });
    try {
      await deleteScript(popup.scriptId);
    } catch (error) {
      return failWith(error);
    }
    if (popup.resume.kind === 'import') return void split(popup.resume.input, popup.resume.flags);
    setPopup(null);
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
    if (!saved) return failToOpen();
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

  const retryFailed = async (resume: Resume) => {
    if (resume.kind === 'import') return split(resume.input, resume.flags);
    setPopup(null);
    const next = await upload(resume.file);
    if (next) await split(next, { title: input.title.file });
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
  const closable = popup !== null && popup.kind !== 'splitting';
  // 나누는 중에 뒤로 가면 리딩 탭 첫 화면으로 간다(10-27 정함). 나누기는 서버에서 계속되고 다 되면 대본 목록에 생긴다.
  const splitting = popup?.kind === 'splitting';
  useWaitExit(splitting, '/reading');
  // 파일을 올리는 중에는 떠나지 못하게 한다 — 나가면 올리던 파일이 버려진다(SOMA-664).
  // 머리 뒤로 버튼·안드로이드 뒤로 키는 막고, iOS 밀어서 나가기는 끈다.
  const working = input.file.kind === 'reading' && !splitting;
  usePreventRemove(working, () => undefined);

  if (popup?.kind === 'failed') {
    return (
      <ReadingStatus
        title={t('reading.splitFailTitle')}
        body={popup.message}
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

  // pen F4 「배역과 대사 찾는 중」 — 팝업이 아니라 전체 화면이다. 머리 뒤로 가기는 리딩 탭으로 나간다(useWaitExit).
  if (popup?.kind === 'splitting') {
    return <SplittingScreen progress={popup.progress} />;
  }

  const file = input.file;
  return (
    <KeyboardLift style={styles.root}>
      <Stack.Screen options={{ gestureEnabled: !working }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Image source={HERO_ACTY} style={styles.heroActy} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
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
              <SelectCard
                key={key}
                title={t(key === 'sample' ? 'scriptCocreate.startSample' : 'scriptCocreate.startMake')}
                sub={t(key === 'sample' ? 'scriptCocreate.startSampleSub' : 'scriptCocreate.startMakeSub')}
                selected={makeChoice === key}
                phLabel={`reading_new_make_${key}`}
                onPress={() => setMakeChoice(key)}
              />
            ))}
            {makeChoice === 'sample' && <SamplePickerBody list={picker.list} entry={picker.entry} pick={picker.pick} inline />}
          </View>
        )}

        {!makeOpen && input.tab === 'file' && file.kind === 'empty' && (
          <Pressable style={({ pressed }) => [styles.dropzone, pressed && styles.pressed]} onPress={onPickFile} accessibilityRole="button" accessibilityLabel={t('reading.attachPick')}>
            <View style={styles.uploadCircle}>
              <Feather name="upload" size={22} color={palette.blue} />
            </View>
            <Text style={styles.dropTitle}>{t('reading.attach')}</Text>
            <Text style={styles.dropSub}>{t('reading.attachHint')}</Text>
            <View style={styles.pickButton}>
              <Text style={styles.pickLabel}>{t('reading.attachPick')}</Text>
            </View>
          </Pressable>
        )}

        {!makeOpen && input.tab === 'file' && file.kind !== 'empty' && (
          <View style={styles.fileCard}>
            <View style={styles.fileIcon}>
              {file.kind === 'reading' ? <ActivityIndicator color={palette.blue} /> : <Feather name="file-text" size={22} color={palette.blue} />}
            </View>
            <View style={styles.fileText}>
              <Text style={styles.fileName} numberOfLines={1}>{file.file.name}</Text>
              <Text style={styles.fileMeta}>
                {file.kind === 'reading' ? `${t('reading.attachReading')} · ${formatFileSize(file.file.size)}` : formatFileSize(file.file.size)}
              </Text>
            </View>
            {file.kind === 'ready' && <Button variant="secondary" size="sm" label={t('reading.replaceFile')} onPress={onPickFile} phLabel="reading_new_replace_file" />}
          </View>
        )}

        {!makeOpen && (input.tab === 'paste' || file.kind === 'ready') && (
          <View style={styles.titleField}>
            <TextField
              label={t('reading.newTitleLabel')}
              value={title}
              onChangeText={(next) => dispatch({ type: 'title', title: next })}
              placeholder={t('reading.newTitlePlaceholder')}
              maxLength={TITLE_MAX}
              returnKeyType="done"
            />
            {input.tab === 'file' && <Text style={styles.titleHint}>{t('reading.newTitleFromFile')}</Text>}
          </View>
        )}

        {!makeOpen && input.tab === 'paste' && (
          <TextField
            label={t('reading.pasteLabel')}
            style={styles.textArea}
            value={input.paste.text}
            onChangeText={(text) => dispatch({ type: 'paste', text })}
            multiline
            placeholder={t('reading.pastePlaceholder')}
            textAlignVertical="top"
          />
        )}
      </ScrollView>

      <CtaBar>
        <View ref={nextTarget.ref} onLayout={nextTarget.onLayout}>
          {makeOpen ? (
            <PrimaryButton
              label={makeChoice === 'sample' ? t('reading.samplePickConfirm') : t('reading.next')}
              phLabel="reading_new_make_next"
              loading={makeChoice === 'sample' && picker.busy}
              loadingLabel={t('loadingText.preparing')}
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
      </CtaBar>

      {picker.dialog}
      <MonologueNameDialog
        target={naming}
        onClose={() => {
          setNaming(null);
          router.replace('/reading/detail');
        }}
      />
      <Modal transparent statusBarTranslucent visible={!!popup} animationType="fade" onRequestClose={() => closable && setPopup(null)}>
        <View style={styles.backdrop}>
          {popup?.kind === 'alert' && (
            <DialogCard title={popup.title} message={popup.message}>
              <DialogButtons confirmLabel={t('common.confirm')} onConfirm={() => setPopup(null)} />
            </DialogCard>
          )}
          {popup?.kind === 'duplicate' && (
            <DialogCard title={t('reading.duplicateTitle')} message={t('reading.duplicateBody', { title: popup.title })}>
              <DialogButtons
                cancelLabel={t('reading.duplicateNew')}
                onCancel={() => void split(popup.input, popup.flags)}
                confirmLabel={t('reading.duplicateOpen')}
                onConfirm={() => {
                  setPopup(null);
                  router.replace('/reading/detail');
                }}
              />
            </DialogCard>
          )}
          {popup?.kind === 'free_limit' && (
            <ProSheetCard
              title={t('pro.scriptLimitTitle')}
              body={t('pro.scriptLimitBody')}
              primary={t('pro.explore')}
              onPrimary={() => {
                setPopup(null);
                router.push('/pro');
              }}
              secondary={t('pro.scriptLimitReplace')}
              onSecondary={() => void askReplace(popup.resume)}
              busy={popup.busy}
            />
          )}
          {popup?.kind === 'free_pick' && (
            <DialogCard title={t('pro.pickTitle')} message={t('pro.pickGuide')}>
              {/* 11/1 전에 넣은 대본은 3개를 넘을 수 있어 목록은 스크롤한다. */}
              <ScrollView style={styles.pickList}>
                {popup.scripts.map((script) => (
                  <Pressable
                    key={script.id}
                    style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
                    accessibilityRole="button"
                    onPress={() => setPopup({ kind: 'free_replace', resume: popup.resume, scriptId: script.id, title: script.title, busy: false })}>
                    <Text style={styles.pickText} numberOfLines={1}>{script.title}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <TextButton label={t('pro.replaceCancel')} onPress={() => setPopup(null)} />
            </DialogCard>
          )}
          {popup?.kind === 'free_replace' && (
            <ProSheetCard
              title={t('pro.replaceTitle', { title: popup.title })}
              body={t('pro.replaceBody')}
              primary={t('pro.replaceConfirm')}
              onPrimary={() => void replaceAndRetry(popup)}
              secondary={t('pro.replaceCancel')}
              onSecondary={() => setPopup(null)}
              busy={popup.busy}
              destructive
            />
          )}
          {popup?.kind === 'not_script' && (
            <DialogCard title={t('reading.notScriptTitle')} message={t('reading.notScriptBody')}>
              <DialogButtons
                cancelLabel={t('reading.notScriptSplit')}
                onCancel={() => void split(popup.input, popup.flags)}
                confirmLabel={t('reading.notScriptRepick')}
                onConfirm={() => setPopup(null)}
              />
            </DialogCard>
          )}
        </View>
      </Modal>
      {tutorialGuide.element}
    </KeyboardLift>
  );
}

/** pen F4. 진행은 서버가 알려 주는 만큼만 — 줄 수를 세기 전에는 퍼센트 없이 제목만 보인다. */
function SplittingScreen({ progress }: { progress: ImportProgress | null }) {
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <View style={[styles.root, styles.splitScreen]}>
      <Image source={MASCOT} style={MASCOT_SIZE.empty} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
      <Text style={styles.splitHeading}>{t('reading.splitTitle')}</Text>
      <Text style={styles.splitSub}>{t('reading.splitSub')}</Text>
      {total > 0 && (
        <View style={styles.splitProgress}>
          <View style={styles.track} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
            <View style={[styles.fill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.splitCount}>{t('reading.splitProgress', { pct, done, total })}</Text>
        </View>
      )}
      {/* 광고 칸(SOMA-876) — 연습 중 칸, 위쪽 묶음 바로 아래 24. */}
      <AdSlot slot="script_parse_wait" style={styles.ad} />
      <InfoBanner title={t('reading.splitLeaveTitle')} body={t('reading.splitLeaveBody')} style={styles.splitBanner} />
    </View>
  );
}

function SegmentTab({ icon, label, on, onPress }: { icon: 'paperclip' | 'edit-3' | 'message-circle'; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentTab, on && styles.segmentTabOn]} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Feather name={icon} size={16} color={on ? palette.text : palette.iconFaint} />
      <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.gutter, paddingTop: space[5], paddingBottom: space[4], gap: space[4] },
  pressed: { opacity: 0.85 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  heroActy: { width: 128, height: 100 },
  heroText: { flex: 1, gap: space[2] },
  title: { ...type.title1, color: palette.text },
  heroSub: { ...type.body2, color: palette.textSub },
  segment: { flexDirection: 'row', backgroundColor: palette.bgSoft, borderRadius: radius.md, padding: space[1], gap: space[1] },
  segmentSlot: { flex: 1 },
  segmentTab: { flex: 1, height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1], borderRadius: radius.sm, paddingHorizontal: space[1] },
  segmentTabOn: { backgroundColor: palette.bg },
  segmentText: { ...type.captionBold, color: palette.textMeta, flexShrink: 1 },
  segmentTextOn: { color: palette.text },
  makeArea: { gap: space[3] },
  dropzone: {
    alignItems: 'center',
    gap: space[2],
    padding: space[6],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.blue,
    backgroundColor: palette.bgSubtle,
  },
  uploadCircle: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  dropTitle: { ...type.body1Bold, color: palette.text },
  dropSub: { ...type.caption, color: palette.textMeta },
  pickButton: { height: 32, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.md, backgroundColor: palette.blueSoft },
  pickLabel: { ...type.body2Bold, color: palette.blueDeep },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  fileIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  fileText: { flex: 1, gap: space[1] },
  fileName: { ...type.body1Bold, color: palette.text },
  fileMeta: { ...type.caption, color: palette.textMeta },
  titleField: { gap: space[2] },
  titleHint: { ...type.caption, color: palette.textMeta },
  textArea: { minHeight: 240, paddingTop: space[3], paddingBottom: space[3] },
  backdrop: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: space.gutter },
  pickList: { alignSelf: 'stretch', maxHeight: 264, marginTop: space[2] },
  pickRow: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[1] },
  pickText: { ...type.body1Bold, color: palette.text },
  splitScreen: { alignItems: 'center', paddingTop: 96, paddingHorizontal: space.gutter, gap: space[3] },
  splitHeading: { ...type.title2, color: palette.text, textAlign: 'center' },
  splitSub: { ...type.body2, color: palette.textSub, textAlign: 'center' },
  splitProgress: { alignSelf: 'stretch', gap: space[2], marginTop: space[3] },
  track: { height: 8, borderRadius: radius.full, backgroundColor: palette.bgSoft, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: palette.blue },
  splitCount: { ...type.body2Bold, color: palette.blueDeep, textAlign: 'center' },
  ad: { alignSelf: 'stretch', marginTop: space[6] },
  splitBanner: { alignSelf: 'stretch', marginTop: 'auto', marginBottom: space[6] },
});
