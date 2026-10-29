import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { useReadableNote } from '@/hooks/use-readable-input';
import { PrimaryButton, TextButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { NavBackButton, NavHeader } from '@/components/ui/nav-header';
import { StatusScreen } from '@/components/ui/status-screen';
import { TextField } from '@/components/ui/text-field';
import { KeyboardLift } from '@/components/keyboard-lift';
import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useAppRating } from '@/hooks/use-app-rating';
import { useWaitExit } from '@/hooks/use-wait-exit';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import {
  EMPTY_DRAFT,
  buildAnswers,
  buildUpdate,
  canAnswer,
  editOf,
  journalMeta,
  journalQuestions,
  journalSummary,
  journalTitle,
  readOptionalJournal,
  type JournalEdit,
  type JournalRow,
  type PracticeJournal,
  type QuestionDraft,
  type QuestionId,
} from '@/lib/practice/journal';
import { clearPractice, getPractice } from '@/lib/practice/session-state';
import { markFirstUseGraduated } from '@/lib/practice/first-use-graduation';
import { SkeletonDetail } from '@/components/ui/skeleton';

type Phase = 'loading' | 'questions' | 'making' | 'view' | 'error';

/**
 * 배우 일지(practice.journal, SOMA-720) — 코칭 정리 카드의 「일지 쓰고 마치기」 뒤, 채팅을 벗어난 별도 화면.
 *
 * pen ⑧ 「배우 일지 질문 1~4 / 4」(XdSzJ·soHlg·dpZuU·ZdSSK) → 「배우 일지(노트) · 완성 (요약형)」(On3qF, 목적별 ZQOn3·s6jZZY)
 * → 오른쪽 위 「편집」(s8Reko). 일지를 남길지 묻는 확인 창은 두지 않는다. 질문은 각각 건너뛸 수 있고 4번째는 「일지 만들기」다.
 * 서버가 코칭 대화로 자동 칸을 만들고 배우의 답은 그대로 넣는다 — 만들지 못하면 답만 담긴 일지를 그대로 보인다.
 * 코칭에서 왔으면(from=coach) 「저장하기」 뒤 오늘 코칭 끝(app/coaching-done)으로, 연습 기록에서 다시 열면 같은 화면에서 보고 고친다.
 */
export default function JournalScreen() {
  const router = useRouter();
  // 코칭을 노트·일지·마무리까지 가 봤으면 첫 사용자 화면은 졸업이다(SOMA-827).
  useEffect(() => {
    void markFirstUseGraduated();
  }, []);
  const params = useLocalSearchParams<{ practiceId?: string; from?: string }>();
  // 마운트 때 한 번만 읽는다 — 마치기에서 clearPractice() 한 뒤에도 같은 회차를 가리킨다.
  const [practiceId] = useState(() => params.practiceId || getPractice()?.practiceId || null);
  const fromCoach = params.from !== 'history';
  const rating = useAppRating();
  const questions = useRef(journalQuestions()).current;

  const [phase, setPhase] = useState<Phase>('loading');
  const [journal, setJournal] = useState<PracticeJournal | null>(null);
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Record<QuestionId, QuestionDraft>>({
    feeling: EMPTY_DRAFT,
    unknown: EMPTY_DRAFT,
    next: EMPTY_DRAFT,
    review: EMPTY_DRAFT,
  });
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<JournalEdit | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const mounted = useRef(true);

  const load = useCallback(async () => {
    if (!practiceId) {
      setPhase('error');
      setError(t('journal.loadFail'));
      return;
    }
    setPhase('loading');
    setError(null);
    try {
      const found = await readOptionalJournal(api.getPracticeJournal, practiceId);
      if (!mounted.current) return;
      if (found) {
        setJournal(found);
        setPhase('view');
      } else {
        setPhase('questions');
      }
    } catch {
      if (!mounted.current) return;
      setPhase('error');
      setError(t('journal.loadFail'));
    }
  }, [practiceId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const question = questions[step];
  const draft = drafts[question.id];
  const last = step === questions.length - 1;

  const setDraft = (next: QuestionDraft) => setDrafts((was) => ({ ...was, [question.id]: next }));

  const make = async (answers: Record<QuestionId, QuestionDraft>) => {
    if (!practiceId) return;
    setPhase('making');
    setError(null);
    try {
      const made = await api.createPracticeJournal(practiceId, buildAnswers(answers));
      if (!mounted.current) return;
      setJournal(made);
      setPhase('view');
    } catch {
      if (!mounted.current) return;
      setPhase('questions');
      setError(t('journal.makeFail'));
    }
  };

  const advance = (answers: Record<QuestionId, QuestionDraft>) => {
    if (last) void make(answers);
    else setStep(step + 1);
  };

  const skip = () => {
    const cleared = { ...drafts, [question.id]: EMPTY_DRAFT };
    setDrafts(cleared);
    advance(cleared);
  };

  // 일지를 만드는 중에 뒤로 가면 코칭 탭 첫 화면으로 간다(10-27 정함). 일지는 서버가 마저 만들고 연습 기록에서 다시 연다.
  const leaveMaking = useWaitExit(phase === 'making', '/coaching');

  const back = () => {
    if (phase === 'making') return leaveMaking();
    if (phase === 'questions' && step > 0) {
      setStep(step - 1);
      return;
    }
    if (edit) {
      setEdit(null);
      return;
    }
    router.back();
  };

  /** 고친 것을 저장한다. 성공하면 편집을 닫는다. */
  const saveEdit = async (): Promise<boolean> => {
    if (!journal || !edit || !practiceId) return true;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updatePracticeJournal(practiceId, buildUpdate(journal, edit));
      if (!mounted.current) return false;
      setJournal(saved);
      setEdit(null);
      return true;
    } catch {
      if (mounted.current) setError(t('journal.saveFail'));
      return false;
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  /** 「저장하기」 — 고치는 중이면 먼저 저장하고, 코칭에서 왔으면 오늘 코칭 끝으로 간다. */
  const saveAndFinish = async () => {
    if (!(await saveEdit())) return;
    if (!fromCoach) return;
    const leave = () => {
      clearPractice();
      router.dismissAll();
      router.push({ pathname: '/coaching-done', params: { practiceId: practiceId ?? '', saved: '1' } });
    };
    if (!practiceId) {
      leave();
      return;
    }
    // AI 코칭을 마칠 때 — 두 번에 한 번(7일 간격·최대 3번) 앱 평가를 묻고 닫힌 뒤 나간다 (SOMA-494, 노트 화면과 같다).
    void rating.after({ kind: 'coach', practiceId }, leave);
  };

  const headerRight =
    phase === 'view' && journal ? (
      <TextButton
        label={edit ? t('journal.done') : t('journal.edit')}
        tone="accent"
        size="large"
        phLabel={edit ? 'journal_edit_done' : 'journal_edit'}
        disabled={saving}
        onPress={() => (edit ? void saveEdit() : setEdit(editOf(journal)))}
      />
    ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('journal.title')} left={<NavBackButton onPress={back} phLabel="journal_back" />} right={headerRight} />

      {phase === 'loading' && <SkeletonDetail lines={5} />}
      {phase === 'making' && (
        <View style={styles.center}>
          <Image source={MASCOT.reading} style={MASCOT_SIZE.xl} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
          <Text style={styles.making}>{t('journal.making')}</Text>
        </View>
      )}

      {phase === 'error' && (
        <StatusScreen title={error ?? t('journal.loadFail')} body={t('journal.loadFailBody')} primary={{ label: t('common.retry'), onPress: () => void load() }} />
      )}

      {/* 키보드가 뜨면 질문·입력칸과 「다음」이 키보드 위로 올라온다(iOS에서 아래 버튼이 키보드에 가렸다). */}
      {phase === 'questions' && (
        <KeyboardLift aboveSafeBottom>
          <KeyboardAwareScroll contentContainerStyle={styles.body}>
            <Text style={styles.step}>{t('journal.step', { step: step + 1, total: questions.length })}</Text>
            <Text style={styles.question} accessibilityRole="header">
              {question.title}
            </Text>
            {question.choices.length > 0 && (
              <View style={styles.chips}>
                {question.choices.map((choice) => (
                  <Chip
                    key={choice.key}
                    label={choice.label}
                    role="radio"
                    selected={draft.choice === choice.key}
                    phLabel={`journal_choice_${question.id}`}
                    onPress={() => setDraft({ ...draft, choice: draft.choice === choice.key ? null : choice.key })}
                  />
                ))}
              </View>
            )}
            <TextField
              key={question.id}
              style={styles.input}
              value={draft.text}
              onChangeText={(text) => setDraft({ ...draft, text })}
              placeholder={question.placeholder}
              multiline
              maxLength={300}
              accessibilityLabel={question.title}
            />
            <Text style={styles.hint}>{t('journal.hint', { action: last ? t('journal.make') : t('journal.next') })}</Text>
            {error && <InlineErrorLine message={error} />}
          </KeyboardAwareScroll>
          <CtaBar safeBottom={false}>
            <TextButton label={t('journal.skip')} onPress={skip} phLabel="journal_skip" />
            <PrimaryButton
              label={last ? t('journal.make') : t('journal.next')}
              disabled={!canAnswer(draft)}
              onPress={() => advance(drafts)}
            />
          </CtaBar>
        </KeyboardLift>
      )}

      {phase === 'view' && journal && (
        <KeyboardLift aboveSafeBottom>
          <JournalBody journal={journal} edit={edit} onEdit={setEdit} open={open} onToggle={(key) => setOpen((was) => ({ ...was, [key]: !was[key] }))} footer={rating.element} />
          {error && (
            <View style={styles.footerError}>
              <InlineErrorLine message={error} />
            </View>
          )}
          {(fromCoach || edit) && (
            <CtaBar safeBottom={false}>
              <PrimaryButton label={t('journal.save')} loading={saving} disabled={saving} onPress={() => void saveAndFinish()} />
            </CtaBar>
          )}
        </KeyboardLift>
      )}
    </SafeAreaView>
  );
}

/** 요약형 완성 일지(On3qF)와 편집(s8Reko). 편집 중엔 후기·다음에 해 볼 것·모든 줄이 입력 칸이 된다. */
function JournalBody({
  journal,
  edit,
  onEdit,
  open,
  onToggle,
  footer,
}: {
  journal: PracticeJournal;
  edit: JournalEdit | null;
  onEdit: (edit: JournalEdit) => void;
  open: Record<string, boolean>;
  onToggle: (key: string) => void;
  /** 스크롤 맨 아래에 놓는 칸 — 앱 평가 카드(SOMA-821: 시트 대신 화면 안 카드). */
  footer?: ReactNode;
}) {
  const note = useReadableNote();
  const summary = journalSummary(journal);
  const notice =
    journal.draft_status === 'failed' ? t('journal.draftFailed') : journal.draft_status === 'pending' ? t('journal.draftPending') : null;
  const showTop = !!edit || !!summary.review || !!summary.feelingTag || summary.unknownCount > 0;

  return (
    <KeyboardAwareScroll contentContainerStyle={styles.body}>
      <Text style={styles.meta}>{journalMeta(journal)}</Text>
      <Text style={styles.title} accessibilityRole="header">
        {journalTitle(journal)}
      </Text>

      {showTop && (
        <View style={styles.reviewBox} testID="journal-review">
          {edit ? (
            <TextInput
              style={styles.reviewInput}
              value={edit.review}
              onChangeText={note.wrap((review) => onEdit({ ...edit, review }))}
              multiline
              maxLength={300}
              placeholder={t('journal.q4Ph')}
              placeholderTextColor={palette.textMeta}
              accessibilityLabel={t('journal.q4')}
            />
          ) : summary.review ? (
            <Text style={styles.review}>{`“${summary.review}”`}</Text>
          ) : null}
          {(summary.feelingTag || summary.unknownCount > 0) && (
            <View style={styles.tags}>
              {summary.feelingTag && (
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{summary.feelingTag}</Text>
                </View>
              )}
              {summary.unknownCount > 0 && (
                <View style={styles.tag}>
                  <Text style={[styles.tagText, styles.tagAccent]}>{t('journal.unknownCount', { count: summary.unknownCount })}</Text>
                </View>
              )}
            </View>
          )}
          {edit && <Text style={styles.editHint}>{t('journal.editHint')}</Text>}
        </View>
      )}

      {(edit || summary.next) && (
        <View style={styles.nextBlock}>
          <Text style={styles.nextLabel}>{t('journal.nextLabel')}</Text>
          {edit ? (
            <TextInput
              style={styles.nextInput}
              value={edit.next}
              onChangeText={note.wrap((next) => onEdit({ ...edit, next }))}
              multiline
              maxLength={300}
              placeholder={t('journal.q3Ph')}
              placeholderTextColor={palette.textMeta}
              accessibilityLabel={t('journal.nextLabel')}
            />
          ) : (
            <Text style={styles.next}>{summary.next}</Text>
          )}
        </View>
      )}

      {notice && <Text style={styles.notice}>{notice}</Text>}
      {edit && note.hint ? <InlineErrorLine message={note.hint} /> : null}

      <View style={styles.list}>
        {summary.rows.map((row) =>
          edit ? (
            <EditRow key={row.key} row={row} edit={edit} onEdit={onEdit} />
          ) : (
            <Pressable
              key={row.key}
              style={styles.row}
              onPress={() => onToggle(row.key)}
              accessibilityRole="button"
              accessibilityState={{ expanded: !!open[row.key] }}
              ph-label={`journal_row_${row.key}`}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  {!open[row.key] && (
                    <Text style={styles.rowPreview} numberOfLines={1}>
                      {row.preview}
                    </Text>
                  )}
                </View>
                <Feather name={open[row.key] ? 'chevron-down' : 'chevron-right'} size={18} color={palette.iconFaint} />
              </View>
              {open[row.key] &&
                row.lines.map((line) => (
                  <Text key={line.id} style={styles.rowLine}>
                    {line.prefix ? `${line.prefix} · ` : ''}
                    {line.text}
                  </Text>
                ))}
            </Pressable>
          ),
        )}
      </View>
      {footer}
    </KeyboardAwareScroll>
  );
}

/** 편집 중 목록 한 줄 — 줄마다 입력 칸(연필). 해 보니의 고른 칩은 그대로 두고 글만 고친다. */
function EditRow({ row, edit, onEdit }: { row: JournalRow; edit: JournalEdit; onEdit: (edit: JournalEdit) => void }) {
  const note = useReadableNote();
  const field = (index: number): { value: string; set: (text: string) => void } => {
    switch (row.key) {
      case 'feeling':
        return { value: edit.feelingText, set: (text) => onEdit({ ...edit, feelingText: text }) };
      case 'unknown':
        return { value: edit.unknown, set: (text) => onEdit({ ...edit, unknown: text }) };
      default: {
        const key = row.key;
        return {
          value: edit[key][index] ?? '',
          set: (text) => onEdit({ ...edit, [key]: edit[key].map((was, i) => (i === index ? text : was)) }),
        };
      }
    }
  };
  // 화면 줄과 편집 값의 자리를 맞춘다 — AI 칸은 원래 순서의 몇 번째인지로 고친다.
  const indexes = row.lines.map((line) => Number(line.id.split('-')[1] ?? 0));
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{row.label}</Text>
      {note.hint ? <InlineErrorLine message={note.hint} /> : null}
      {row.lines.map((line, i) => {
        const { value, set } = field(indexes[i]);
        return (
          <View key={line.id} style={styles.editField}>
            {line.prefix && row.key !== 'feeling' ? <Text style={styles.editPrefix}>{line.prefix}</Text> : null}
            <TextInput
              style={styles.editInput}
              value={value}
              onChangeText={note.wrap(set)}
              multiline
              maxLength={200}
              accessibilityLabel={row.label}
            />
            <Feather name="edit-2" size={14} color={palette.iconFaint} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1, gap: space[1] },
  center: { flex: 1, alignItems: 'center', paddingTop: 96, gap: space[4], paddingHorizontal: space.gutter },
  making: { ...type.title2, color: palette.text, textAlign: 'center' },
  footerError: { paddingHorizontal: space.gutter, paddingBottom: space[2] },
  body: { paddingTop: space[3], paddingHorizontal: space.gutter, paddingBottom: space[6], gap: space[4] },

  step: { ...type.captionBold, color: palette.blueDeep },
  question: { ...type.title2, color: palette.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  input: { minHeight: 96, paddingVertical: space[3], textAlignVertical: 'top' },
  hint: { ...type.caption, color: palette.textMeta },

  meta: { ...type.captionBold, color: palette.textMeta },
  title: { ...type.title2, color: palette.text },
  reviewBox: { gap: space[3], backgroundColor: palette.bgSubtle, borderRadius: radius.lg, padding: space[4] },
  review: { ...type.headline, color: palette.text },
  reviewInput: { ...type.headline, color: palette.text, padding: 0, textAlignVertical: 'top' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  tag: { backgroundColor: palette.bg, borderRadius: radius.full, paddingVertical: space[1.5], paddingHorizontal: space[3] },
  tagText: { ...type.captionBold, color: palette.textSub },
  tagAccent: { color: palette.blueDeep },
  editHint: { ...type.caption, color: palette.blueDeep },
  nextBlock: { gap: space[1.5] },
  nextLabel: { ...type.captionBold, color: palette.blueDeep },
  next: { ...type.body1Bold, color: palette.text },
  nextInput: { ...type.body1Bold, color: palette.text, padding: 0, textAlignVertical: 'top' },
  notice: { ...type.captionBold, color: palette.amber },
  list: { gap: 0 },
  row: { gap: space[2], paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: palette.border },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  rowLabel: { ...type.body2Bold, color: palette.text },
  rowPreview: { ...type.caption, color: palette.textMeta },
  rowLine: { ...type.body2, color: palette.textSub },
  editField: { flexDirection: 'row', alignItems: 'center', gap: space[2], backgroundColor: palette.bgSubtle, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: space[2] },
  editPrefix: { ...type.captionBold, color: palette.blueDeep },
  editInput: { flex: 1, ...type.caption, color: palette.textSub, padding: 0 },
});
