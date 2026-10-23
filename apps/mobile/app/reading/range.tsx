import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { Image } from 'expo-image';
import { PrimaryButton } from '@/components/ui/buttons';
import { firstPracticeRange } from '@/lib/reading/redesign-748';
import { useAppDialog } from '@/components/app-dialog';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { TARGET } from '@/lib/spotlight-targets';
import { micPermissionState, requestMicPermission, type MicPermission } from '@/hooks/use-reading-mic';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import {
  buildStartBody,
  defaultMyCharacterIds,
  dialogueNumbers,
  fewLines,
  isGroupCharacter,
  rangeError,
  rangeOfDialogueNos,
  rangeOfLineIds,
  rangeTitle,
  recentRanges,
  roleLineCount,
  sceneTitle,
  snapRangeToDialogues,
  startGate,
  turnRoles,
  type LineRange,
} from '@/lib/reading/session-plan';
import { getCurrent, listSessions, startSession, updateCurrent, type MaskMode } from '@/lib/reading/store';
import * as engine from '@/lib/reading/tts/engine';
import type { ScriptLine, SessionCard } from '@/lib/reading/types';
import { newRequestId } from '@/lib/request-id';
import { relativeDay } from '@/lib/reading/script-cards';
import { translate as t } from '@/lib/i18n';

/**
 * 새 연습(R8, reading.cast · reading.session). 연습마다 ① 내 배역(여러 명, 나머지는 앱이 읽음) ② 구간(최근 구간 ·
 * 장면으로 찾기 · 대사로 찾기) ③ 대사 보기(기기가 대본마다 마지막 값을 기억)를 정하고 "시작"을 누를 때 회차를 한 번
 * 만든다. 방식은 읽어주기 하나이고 녹음은 늘 하므로 마이크 권한이 없으면 시작하지 못한다(R8.7).
 * 회차 상세 「이 구간으로 다시 연습」은 params roles(쉼표로 이은 배역 id)·start·end(줄 id)로 그 배역·구간을 골라 둔다.
 */
const MASKS: { key: MaskMode; label: string }[] = [
  { key: 'none', label: t('reading.maskNone') },
  { key: 'mine', label: t('reading.maskMine') },
  { key: 'all', label: t('reading.maskAll') },
];

const MASCOT = require('@/assets/images/mascot-reading.png');

/** suggest 는 첫 연습(회차 없음)의 추천 — 짧은 구간 · 처음부터 끝까지(pen 「새 · 연습 구역 첫 연습」). */
type Tab = 'suggest' | 'recent' | 'scene' | 'line';
const TAB_LABEL: Record<Tab, string> = {
  suggest: t('reading.bySuggest'),
  recent: t('reading.byRecent'),
  scene: t('reading.byScene'),
  line: t('reading.byLine'),
};

const NO_LINES: ScriptLine[] = [];

export default function ReadingRange() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ roles?: string; start?: string; end?: string }>();
  const { alert, confirm, dialog } = useAppDialog();
  const script = getCurrent();
  const lines = script?.lines ?? NO_LINES;
  const numbers = useMemo(() => dialogueNumbers(lines), [lines]);
  const scenes = useMemo(
    () =>
      script?.scenes.flatMap((scene) => {
        const range = rangeOfLineIds(script.lineIds, scene.start_line_id, scene.end_line_id);
        return range ? [{ ...scene, ...range }] : [];
      }) ?? [],
    [script],
  );
  const dialogues = useMemo(() => lines.map((l, i) => ({ l, i })).filter((x) => x.l.type === 'dialogue'), [lines]);
  // 함께 말하는 줄의 묶음 배역은 칩에 두지 않는다(SOMA-709).
  const cast = useMemo(() => (script?.characters ?? []).filter((c) => !isGroupCharacter(c)), [script]);
  const hasHistory = !!script?.lastSession;

  const [selected, setSelected] = useState<string[]>(() =>
    script ? defaultMyCharacterIds({ last_session: script.lastSession, characters: script.characters, rolesParam: params.roles }) : [],
  );
  /** null 이면 아직 고르지 않았다 — 최근 구간의 첫 줄, 없으면 대본 전체. */
  const [picked, setPicked] = useState<LineRange | null>(() => (script ? rangeOfLineIds(script.lineIds, params.start, params.end) : null));
  const [tab, setTab] = useState<Tab | null>(null);
  const [picking, setPicking] = useState<'start' | 'end'>('start');
  const [mask, setMask] = useState<MaskMode>(script?.maskMode ?? 'none');
  /** 회차 목록. null 은 불러오는 중. */
  const [sessions, setSessions] = useState<SessionCard[] | null>(hasHistory ? null : []);
  /** null 은 확인 중. 묻는 건 [시작]을 누를 때다(SOMA-772). */
  const [mic, setMic] = useState<MicPermission | null>(null);
  const [busy, setBusy] = useState(false);
  // 회차 시작의 요청 id — 이 화면에서 한 번 정해 재시도에도 같은 회차 하나가 된다.
  const requestId = useRef(newRequestId());
  const rangePickTarget = useSpotlightTarget(TARGET.readingRangePick);
  const rangeStartTarget = useSpotlightTarget(TARGET.readingRangeStart);
  const tutorialGuide = useTutorialSpotlight('readingRange', { ready: !!script });

  useEffect(() => {
    if (!script || !hasHistory) return;
    let alive = true;
    listSessions(script.id)
      .then((list) => alive && setSessions(list))
      .catch(() => alive && setSessions([]));
    return () => {
      alive = false;
    };
  }, [script, hasHistory]);

  // 들어올 때·돌아올 때는 상태만 본다. OS 창은 [시작]을 누를 때 띄우고, 다시 물을 수 없으면 설정으로 보낸다(R8.7, SOMA-772).
  useEffect(() => {
    let alive = true;
    const apply = (state: MicPermission) => alive && setMic(state);
    void micPermissionState().then(apply);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void micPermissionState().then(apply);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  // Wi-Fi 면 상대역 목소리를 미리 받아 둔다 — 실행 화면에서 기다리지 않게. 화면을 막지 않고 실패도 알리지 않는다.
  useEffect(() => {
    void engine.prefetchIfWifi();
  }, []);

  const recents = useMemo(
    () =>
      recentRanges(sessions ?? []).flatMap((card) => {
        const range = rangeOfDialogueNos(lines, card.range.start_dialogue_no, card.range.end_dialogue_no);
        return range ? [{ card, range }] : [];
      }),
    [sessions, lines],
  );

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

  const whole = snapRangeToDialogues(lines, 0, lines.length - 1) ?? { startIndex: 0, endIndex: Math.max(0, lines.length - 1) };
  const pickedCast = cast.filter((c) => selected.includes(c.id));
  // 내 차례로 읽는 배역 — 고른 배역과 그 배역이 든 함께 말하는 줄의 묶음 배역(play 와 같은 turnRoles, SOMA-709·785).
  const myTurnRoles = turnRoles(script.characters, pickedCast.map((c) => c.id));
  // 첫 연습이면 처음부터 대사 10줄을 짧은 구간으로 골라 둔다 — 기기에서만 정한다.
  const short = hasHistory ? null : firstPracticeRange(lines, myTurnRoles);
  const range = picked ?? recents[0]?.range ?? short ?? whole;
  const showRecent = hasHistory && (sessions === null || recents.length > 0);
  const tabs: Tab[] = showRecent ? ['recent', 'scene', 'line'] : short ? ['suggest', 'scene', 'line'] : ['scene', 'line'];
  const activeTab = tab && tabs.includes(tab) ? tab : tabs[0];
  const isActive = (r: LineRange) => r.startIndex === range.startIndex && r.endIndex === range.endIndex;
  const dlgIn = dialogues.filter((x) => x.i >= range.startIndex && x.i <= range.endIndex).length;
  // 고른 배역의 대사가 구간 안에 거의 없으면 처음 안내 대신 알린다 — 시작은 막지 않는다(SOMA-709).
  const few = fewLines(lines, myTurnRoles, range.startIndex, range.endIndex);
  const loadingDefault = picked === null && sessions === null;
  const gate = startGate({ roleCount: selected.length, micGranted: mic === null ? null : true, loading: loadingDefault });
  const wholeDialogues = dialogues.length;

  const toggleRole = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // 두 단계: 시작 대사 탭 → 끝 대사 탭. 끝이 시작보다 앞이면 뒤바꾼다.
  const pickLine = (i: number) => {
    if (picking === 'start') {
      setPicked({ startIndex: i, endIndex: Math.max(i, range.endIndex) });
      setPicking('end');
    } else {
      setPicked(i < range.startIndex ? { startIndex: i, endIndex: range.startIndex } : { startIndex: range.startIndex, endIndex: i });
      setPicking('start');
    }
  };
  const pickRange = (r: LineRange) => {
    setPicked(r);
    setPicking('start');
  };

  const onStart = async () => {
    if (gate !== 'ready' || busy) return;
    const myRoles = pickedCast.map((c) => c.name);
    if (rangeError(lines, myRoles, range.startIndex, range.endIndex)) {
      void alert({ title: t('reading.startFailed'), message: t('reading.errorEmptyRange') });
      return;
    }
    if (mic !== 'granted') {
      setBusy(true);
      const asked = await requestMicPermission().finally(() => setBusy(false));
      if (asked === 'blocked') {
        setMic('blocked');
        if (await confirm({ title: t('reading.micBlockedTitle'), message: t('reading.micBlockedBody'), confirmLabel: t('reading.micOpenSettings') })) {
          void Linking.openSettings();
        }
        return;
      }
      if (asked !== 'granted') return;
      setMic('granted');
    }
    setBusy(true);
    try {
      await startSession(
        script.id,
        buildStartBody({
          requestId: requestId.current,
          myCharacterIds: selected,
          startLineId: script.lineIds[range.startIndex],
          endLineId: script.lineIds[range.endIndex],
        }),
      );
      await updateCurrent({ maskMode: mask });
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

  const startLabel = busy
    ? t('common.saving')
    : gate === 'pickRole'
      ? t('reading.startNeedsRole')
      : t('reading.startSession', { count: dlgIn });

  const mono = cast.length === 1;
  const firstRun = !hasHistory;
  // 구간 칩 — 추천(첫 연습) 또는 지난 구간 · 처음부터 끝까지 · 장면. 독백은 처음부터 끝까지 하나뿐이다(pen R8.13).
  const chips: { key: string; label: string; range: LineRange }[] = [];
  if (!mono) {
    if (short) chips.push({ key: 'short', label: t('reading.rangeChipSuggest', { count: short.dialogueCount }), range: short });
    if (recents[0]) chips.push({ key: 'recent', label: rangeTitle(recents[0].card.range_name, t), range: recents[0].range });
  }
  chips.push({ key: 'whole', label: t('reading.rangeAll'), range: whole });
  if (!mono) for (const sc of scenes) chips.push({ key: `scene${sc.no}`, label: t('reading.rangeScene', { n: sc.no }), range: sc });
  const micAsk = mic !== 'granted';
  const mainLabel = busy ? t('common.saving') : gate === 'pickRole' ? t('reading.startNeedsRole') : t(micAsk ? 'reading.startWithMic' : 'reading.startPlain');

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* pen R8 — 액티 말풍선(회색): 누구를 연기할까요? + 대본 이름 · 대사 수(첫 연습이면 안내). */}
        <View style={styles.mascotRow}>
          <Image source={MASCOT} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
          <View style={styles.bubble}>
            <Text style={styles.title}>{t('reading.rangeHeading')}</Text>
            <Text style={styles.sub}>{firstRun && micAsk ? t('reading.rangeFirstGuide') : `${script.title} · ${t('reading.dialogueCount', { count: script.dialogueCount })}`}</Text>
          </View>
        </View>

        <View style={styles.roleList} ref={rangePickTarget.ref} onLayout={rangePickTarget.onLayout}>
          {cast.map((c) => {
            const on = selected.includes(c.id);
            return (
              <Pressable
                key={c.id}
                style={[styles.roleCard, on && styles.roleCardOn]}
                onPress={() => toggleRole(c.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}>
                <View style={styles.rowBody}>
                  <Text style={[styles.roleName, on && styles.roleNameOn]}>{c.name}</Text>
                  <Text style={styles.roleMeta}>
                    {mono ? t('reading.monologueCard', { count: script.dialogueCount }) : t('reading.dialogueCount', { count: roleLineCount(c, lines, script.characters) })}
                  </Text>
                </View>
                {on && <Feather name="check" size={20} color={palette.blue} />}
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.section, styles.sectionGap]}>{t('reading.rangeQuestion')}</Text>
        <View style={styles.chipWrap}>
          {chips.map((c) => {
            const on = isActive(c.range);
            return (
              <Pressable key={c.key} style={[styles.rangeChip, on && styles.rangeChipOn]} onPress={() => pickRange(c.range)} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <Text style={[styles.rangeChipText, on && styles.rangeChipTextOn]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {few !== null && (
          <View style={styles.fewRow}>
            <Feather name="info" size={14} color={palette.amber} />
            <Text style={styles.fewText}>{t('reading.rangeFewShort', { roles: pickedCast.map((c) => c.name).join(', '), count: few })}</Text>
          </View>
        )}

        <View style={styles.maskRow}>
          <View style={styles.rowBody}>
            <Text style={styles.maskTitle}>{t('reading.maskSwitch')}</Text>
            <Text style={styles.maskSub}>{t('reading.maskSwitchSub')}</Text>
          </View>
          <Switch
            value={mask !== 'none'}
            onValueChange={(on) => setMask(on ? 'mine' : 'none')}
            trackColor={{ true: palette.blue, false: palette.border }}
            thumbColor={palette.onAccent}
            ios_backgroundColor={palette.border}
          />
        </View>

        {firstRun && micAsk && (
          <View style={styles.howBox}>
            <Text style={styles.howTitle}>{t('reading.howTitle')}</Text>
            {(['reading.how1', 'reading.how2', 'reading.how3'] as const).map((k) => (
              <View key={k} style={styles.howRow}>
                <View style={styles.howDot} />
                <Text style={styles.howText}>{t(k)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {mic === 'blocked' && (
          <View style={styles.micBox}>
            <Feather name="mic-off" size={18} color={palette.amber} />
            <View style={styles.rowBody}>
              <Text style={styles.micTitle}>{t('reading.micNeededTitle')}</Text>
              <Text style={styles.micBody}>{t('reading.micNeededBody')}</Text>
            </View>
            <Pressable onPress={() => void Linking.openSettings()} hitSlop={8}>
              <Text style={styles.micLink}>{t('reading.micOpenSettings')}</Text>
            </Pressable>
          </View>
        )}
        <View ref={rangeStartTarget.ref} onLayout={rangeStartTarget.onLayout}>
          <PrimaryButton label={mainLabel} onPress={() => void onStart()} disabled={gate !== 'ready' || busy} />
        </View>
      </View>
      {dialog}
      {tutorialGuide.element}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 14 },
  mascotRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bubble: { flex: 1, backgroundColor: palette.bgSoft, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16, gap: 4 },
  roleList: { gap: 10 },
  roleCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.card, borderRadius: 14, borderWidth: 1, borderColor: palette.border, paddingVertical: 14, paddingHorizontal: 16 },
  roleCardOn: { backgroundColor: palette.blueMist, borderColor: palette.blue },
  roleName: { color: palette.text, fontSize: 16, fontWeight: '800', lineHeight: 22 },
  roleNameOn: { color: palette.blueDeep },
  roleMeta: { color: palette.textFaint, fontSize: 13, fontWeight: '600', lineHeight: 20 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rangeChip: { borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.card, paddingHorizontal: 14, paddingVertical: 9 },
  rangeChipOn: { borderColor: palette.blue, backgroundColor: palette.blueMist },
  rangeChipText: { color: palette.textDim, fontSize: 14, fontWeight: '700', lineHeight: 21 },
  rangeChipTextOn: { color: palette.blueDeep },
  fewRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  maskTitle: { color: palette.text, fontSize: 15, fontWeight: '800', lineHeight: 22 },
  maskSub: { color: palette.textFaint, fontSize: 12, fontWeight: '600', lineHeight: 18 },
  howBox: { gap: 10, marginTop: 8 },
  howTitle: { color: palette.textDim, fontSize: 13, fontWeight: '800' },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  howDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.blueSoft },
  howText: { color: palette.text, fontSize: 14, fontWeight: '600', lineHeight: 21 },
  mascot: { width: 52, height: 58 },
  title: { color: palette.text, fontSize: 18, fontWeight: '900', lineHeight: 24 },
  sub: { color: palette.blue, fontSize: 13, fontWeight: '700', lineHeight: 20 },
  section: { color: palette.textDim, fontSize: 14, fontWeight: '800', lineHeight: 21 },
  sectionGap: { marginTop: 4 },
  hint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12, marginTop: -6 },
  bleed: { marginHorizontal: -24 },
  roleChips: { gap: 8, paddingHorizontal: 24 },
  roleChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: palette.bgSoft },
  roleChipOn: { backgroundColor: palette.blueSoft },
  roleChipText: { color: palette.textDim, fontSize: 15, fontWeight: '700', lineHeight: 23 },
  roleChipTextOn: { color: palette.blueDeep },
  // pen 「배역 칩」의 대사 수 — 이름보다 2pt 작은 grey500
  roleChipCount: { color: palette.textFaint, fontSize: 13, fontWeight: '500', lineHeight: 23 },
  fewBox: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: palette.amberSoft, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14 },
  fewText: { flex: 1, color: palette.amber, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.blueMist, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  tipText: { flex: 1, color: palette.blueDeep, fontSize: 14, fontWeight: '700', lineHeight: 21 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 4 },
  optionOn: { backgroundColor: palette.blueSoft, paddingHorizontal: 16 },
  optionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { color: palette.text, fontSize: 16, fontWeight: '800', lineHeight: 24 },
  optionMeta: { color: palette.textFaint, fontSize: 13, fontWeight: '600', lineHeight: 20 },
  rangeBlock: { gap: 10 },
  tabs: { flexDirection: 'row', backgroundColor: palette.bgSoft, borderRadius: 10, padding: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8 },
  tabOn: { backgroundColor: palette.card },
  tabText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  tabTextOn: { color: palette.text },
  pickBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.blueSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  pickText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  pickReset: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14 },
  rowIn: { backgroundColor: palette.blueMist, borderColor: palette.blueLine },
  rowNo: { color: palette.textFaint, fontFamily: 'Pretendard-SemiBold', fontSize: 13, width: 22, textAlign: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 14 },
  rowTitleOn: { color: palette.blueDeep },
  rowLine: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  sceneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14 },
  recentTitle: { flex: 1 },
  recentMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  tag: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tagEnd: { backgroundColor: palette.textDim },
  tagText: { color: palette.onAccent, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  footer: { paddingHorizontal: 24, paddingTop: 12, backgroundColor: palette.bg, gap: 10 },
  maskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  maskChip: { flex: 1, alignItems: 'center', backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 999, paddingVertical: 8 },
  maskChipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  maskText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  maskTextOn: { color: palette.blueDeep },
  micBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.amberSoft, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  micTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 13 },
  micBody: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  micLink: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  primary: { backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: palette.checkOff },
  primaryText: { color: palette.onAccent, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: palette.onAccent, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
