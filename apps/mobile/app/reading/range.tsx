import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { hasMicPermission } from '@/hooks/use-reading-mic';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { buildStartBody, dialogueNumbers, rangeError, sceneRanges, snapRangeToDialogues } from '@/lib/reading/session-plan';
import { getCurrent, newRequestId, startSession, updateCurrent, type MaskMode } from '@/lib/reading/store';
import type { ReadingMode } from '@/lib/reading/types';
import { translate as t } from '@/lib/i18n';

/**
 * 시작 위치(R03, reading.session). 방식(읽어주기·암기 대조), 구간(장면으로 찾기 = 장면 줄 경계, 없으면 지문;
 * 대사로 찾기 = 대사 번호), 가리기(기기가 대본마다 마지막 값을 기억), 녹음 켬끔을 정하고 "시작"을 누를 때
 * 회차를 한 번 만든다. 설정 화면만 다녀가면 아무것도 남지 않는다. 마이크 권한이 없으면 manual 로만 시작한다.
 */
const MASKS: { key: MaskMode; label: string }[] = [
  { key: 'none', label: t('reading.maskNone') },
  { key: 'mine', label: t('reading.maskMine') },
  { key: 'all', label: t('reading.maskAll') },
];

export default function ReadingRange() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { alert, dialog } = useAppDialog();
  const script = getCurrent();
  const lines = useMemo(() => script?.lines ?? [], [script]);
  const numbers = useMemo(() => dialogueNumbers(lines), [lines]);
  const scenes = useMemo(() => sceneRanges(lines), [lines]);
  const dialogues = useMemo(() => lines.map((l, i) => ({ l, i })).filter((x) => x.l.type === 'dialogue'), [lines]);

  const [tab, setTab] = useState<'line' | 'scene'>('scene');
  const [mode, setMode] = useState<ReadingMode>('read');
  const [mask, setMask] = useState<MaskMode>(script?.maskMode ?? 'none');
  const whole = snapRangeToDialogues(lines, 0, Math.max(0, lines.length - 1));
  const [start, setStart] = useState(whole?.startIndex ?? 0);
  const [end, setEnd] = useState(whole?.endIndex ?? Math.max(0, lines.length - 1));
  const [picking, setPicking] = useState<'start' | 'end'>('start');
  const [micGranted, setMicGranted] = useState<boolean | null>(null);
  const [record, setRecord] = useState(true);
  const [busy, setBusy] = useState(false);
  // 회차 시작의 요청 id — 이 화면에서 한 번 정해 재시도에도 같은 회차 하나가 된다.
  const requestId = useRef(newRequestId());

  useEffect(() => {
    let alive = true;
    void hasMicPermission().then((granted) => {
      if (!alive) return;
      setMicGranted(granted);
      setRecord(granted);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!script) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t('reading.noScript')}</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading')}>
          <Text style={styles.pillText}>{t('reading.toMyScripts')}</Text>
        </Pressable>
      </View>
    );
  }

  // 두 단계: 시작 지점 탭 → 끝 지점 탭. 끝이 시작보다 앞이면 자동으로 뒤바꾼다.
  const pickLine = (i: number) => {
    if (picking === 'start') {
      setStart(i);
      if (i > end) setEnd(i);
      setPicking('end');
    } else {
      if (i < start) {
        setEnd(start);
        setStart(i);
      } else {
        setEnd(i);
      }
      setPicking('start');
    }
  };
  const pickScene = (from: number, to: number) => {
    setStart(from);
    setEnd(to);
    setPicking('start');
  };

  const dlgIn = dialogues.filter((x) => x.i >= start && x.i <= end).length;
  const startLine = lines[start];
  const endLine = lines[end];
  const advance = micGranted ? 'silence' : 'manual';

  const onStart = async () => {
    const problem = rangeError(lines, script.myRoles, start, end);
    if (problem) {
      void alert({ title: t('reading.startFailed'), message: t('reading.errorEmptyRange') });
      return;
    }
    const myCharacterIds = script.characters.filter((c) => script.myRoles.includes(c.name)).map((c) => c.id);
    if (myCharacterIds.length === 0) {
      void alert({ title: t('reading.startFailed'), message: t('reading.errorCastInvalid') });
      return;
    }
    setBusy(true);
    try {
      await startSession(
        script.id,
        buildStartBody({
          requestId: requestId.current,
          myCharacterIds,
          mode,
          startLineId: script.lineIds[start],
          endLineId: script.lineIds[end],
          advance,
          record: micGranted ? record : false,
        }),
      );
      await updateCurrent({ startIndex: start, endIndex: end, maskMode: mask, status: 'reading', index: start });
      router.replace('/reading/play');
    } catch (e) {
      const code = (e as { code?: string })?.code;
      const message =
        code === 'empty_range'
          ? t('reading.errorEmptyRange')
          : code === 'invalid_characters'
            ? t('reading.errorCastInvalid')
            : scriptErrorMessage(e);
      void alert({ title: t('reading.startFailed'), message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>STEP 3 · 시작 위치</Text>
        <Text style={styles.title}>어디부터 어디까지 연습할까요?</Text>
        <Text style={styles.sub}>{script.title} · 대사 {script.dialogueCount}개 · 내 배역 {script.myRoles.join(', ')}</Text>

        {/* 방식 */}
        <View style={styles.modeRow}>
          {(['read', 'quiz'] as const).map((m) => (
            <Pressable key={m} style={[styles.modeCard, mode === m && styles.modeCardOn]} onPress={() => setMode(m)}>
              <Text style={[styles.modeTitle, mode === m && styles.modeTitleOn]}>{m === 'read' ? t('reading.modeRead') : t('reading.modeQuiz')}</Text>
              <Text style={styles.modeDesc}>{m === 'read' ? t('reading.modeReadDesc') : t('reading.modeQuizDesc')}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.tabs}>
          {(['scene', 'line'] as const).map((k) => (
            <Pressable key={k} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => setTab(k)}>
              <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{k === 'line' ? t('reading.byLine') : t('reading.byScene')}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.maskRow}>
          {MASKS.map((m) => (
            <Pressable key={m.key} style={[styles.maskChip, mask === m.key && styles.maskChipOn]} onPress={() => setMask(m.key)}>
              <Text style={[styles.maskText, mask === m.key && styles.maskTextOn]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'line' && (
          <View style={styles.pickBar}>
            <Text style={styles.pickText}>{picking === 'start' ? t('reading.pickStart') : t('reading.pickEnd')}</Text>
            <Pressable
              onPress={() => {
                setStart(whole?.startIndex ?? 0);
                setEnd(whole?.endIndex ?? Math.max(0, lines.length - 1));
                setPicking('start');
              }}>
              <Text style={styles.pickReset}>전체 선택</Text>
            </Pressable>
          </View>
        )}

        {tab === 'line' ? (
          <View style={styles.list}>
            {dialogues.map(({ l, i }) => {
              const inRange = i >= start && i <= end;
              const isStart = i === start;
              const isEnd = i === end;
              return (
                <Pressable key={i} style={[styles.row, inRange && styles.rowIn]} onPress={() => pickLine(i)}>
                  <Text style={styles.rowNo}>{numbers[i]}</Text>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowRole}>{l.type === 'dialogue' ? l.role : ''}</Text>
                    <Text style={styles.rowLine} numberOfLines={1}>{l.text}</Text>
                  </View>
                  {isStart && <View style={styles.tag}><Text style={styles.tagText}>시작</Text></View>}
                  {isEnd && !isStart && <View style={[styles.tag, styles.tagEnd]}><Text style={styles.tagText}>끝</Text></View>}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.list}>
            {scenes.map((s, n) => {
              const active = start === s.startIndex && end === s.endIndex;
              const first = lines[s.startIndex];
              return (
                <Pressable key={n} style={[styles.sceneRow, active && styles.rowIn]} onPress={() => pickScene(s.startIndex, s.endIndex)}>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowRole}>{s.label}</Text>
                    <Text style={styles.rowLine} numberOfLines={1}>
                      {t('reading.dialogueCount', { count: s.dialogueCount })} · {first?.type === 'dialogue' ? `${first.role} ${first.text}` : first?.text}
                    </Text>
                  </View>
                  {active && <Feather name="check" size={18} color={palette.blue} />}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* 녹음 */}
        <View style={styles.recordRow}>
          <View style={styles.rowBody}>
            <Text style={styles.recordTitle}>{t('reading.recordToggle')}</Text>
            <Text style={styles.recordNote}>{micGranted === false ? t('reading.micDeniedRecord') : t('reading.recordNote')}</Text>
          </View>
          <Switch value={micGranted ? record : false} onValueChange={setRecord} disabled={!micGranted} trackColor={{ true: palette.blue }} />
        </View>
        {micGranted === false && <Text style={styles.micNote}>{t('reading.micDeniedNote')}</Text>}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.preview}>
          <Text style={styles.previewText} numberOfLines={1}>
            시작 · {startLine?.type === 'dialogue' ? `${startLine.role} ${startLine.text}` : startLine?.text}
          </Text>
          <Text style={styles.previewText} numberOfLines={1}>
            끝 · {endLine?.type === 'dialogue' ? `${endLine.role} ${endLine.text}` : endLine?.text}
          </Text>
        </View>
        <Pressable style={[styles.primary, busy && styles.primaryOff]} onPress={onStart} disabled={busy}>
          <Text style={styles.primaryText}>{busy ? t('common.saving') : t('reading.startSession', { count: dlgIn })}</Text>
        </Pressable>
      </View>
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { padding: 20, gap: 10 },
  step: { color: palette.blue, fontFamily: 'Pretendard-SemiBold', fontSize: 12, letterSpacing: 0.3 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 2 },
  sub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, marginBottom: 4 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeCard: { flex: 1, backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  modeCardOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  modeTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 14 },
  modeTitleOn: { color: palette.blueDeep },
  modeDesc: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 11, lineHeight: 16 },
  tabs: { flexDirection: 'row', backgroundColor: palette.bgSoft, borderRadius: 10, padding: 3, marginTop: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8 },
  tabOn: { backgroundColor: palette.card },
  tabText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  tabTextOn: { color: palette.text },
  maskRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  maskChip: { flex: 1, alignItems: 'center', backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 999, paddingVertical: 8 },
  maskChipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  maskText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  maskTextOn: { color: palette.blueDeep },
  pickBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.blueSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginTop: 4 },
  pickText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  pickReset: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  list: { gap: 8, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14 },
  rowIn: { backgroundColor: palette.blueMist, borderColor: palette.blueLine },
  rowNo: { color: palette.textFaint, fontFamily: 'Pretendard-SemiBold', fontSize: 13, width: 22, textAlign: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowRole: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 14 },
  rowLine: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  sceneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  tag: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tagEnd: { backgroundColor: palette.textDim },
  tagText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 8 },
  recordTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 14 },
  recordNote: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  micNote: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 12, paddingHorizontal: 2 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg, gap: 10 },
  preview: { gap: 2 },
  previewText: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  primary: { backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: palette.checkOff },
  primaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
