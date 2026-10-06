import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { TARGET } from '@/lib/spotlight-targets';
import { hasMicPermission, micPermissionGranted } from '@/hooks/use-reading-mic';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import {
  buildStartBody,
  defaultMyCharacterIds,
  dialogueNumbers,
  rangeError,
  rangeOfDialogueNos,
  rangeOfLineIds,
  rangeTitle,
  recentRanges,
  sceneTitle,
  snapRangeToDialogues,
  startGate,
  type LineRange,
} from '@/lib/reading/session-plan';
import { getCurrent, listSessions, startSession, updateCurrent, type MaskMode } from '@/lib/reading/store';
import * as engine from '@/lib/reading/tts/engine';
import type { ScriptLine } from '@/lib/reading/parse';
import type { SessionCard } from '@/lib/reading/types';
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

type Tab = 'recent' | 'scene' | 'line';
const TAB_LABEL: Record<Tab, string> = {
  recent: t('reading.byRecent'),
  scene: t('reading.byScene'),
  line: t('reading.byLine'),
};

const NO_LINES: ScriptLine[] = [];

export default function ReadingRange() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ roles?: string; start?: string; end?: string }>();
  const { alert, dialog } = useAppDialog();
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
  const cast = script?.characters ?? [];
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
  const [micGranted, setMicGranted] = useState<boolean | null>(null);
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

  // 들어올 때 한 번 묻고, 거절했으면 [설정 열기]로 보낸다(R8.7). 돌아올 때는 확인만 한다 — OS 팝업이 닫히면서도
  // 앱이 다시 active 가 되니, 그때 또 물으면 팝업이 거듭 뜬다.
  useEffect(() => {
    let alive = true;
    const apply = (granted: boolean) => alive && setMicGranted(granted);
    void hasMicPermission().then(apply);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void micPermissionGranted().then(apply);
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
  const range = picked ?? recents[0]?.range ?? whole;
  const showRecent = hasHistory && (sessions === null || recents.length > 0);
  const tabs: Tab[] = showRecent ? ['recent', 'scene', 'line'] : ['scene', 'line'];
  const activeTab = tab && tabs.includes(tab) ? tab : tabs[0];
  const isActive = (r: LineRange) => r.startIndex === range.startIndex && r.endIndex === range.endIndex;
  const dlgIn = dialogues.filter((x) => x.i >= range.startIndex && x.i <= range.endIndex).length;
  const loadingDefault = picked === null && sessions === null;
  const gate = startGate({ roleCount: selected.length, micGranted, loading: loadingDefault });
  const pickedCast = cast.filter((c) => selected.includes(c.id));

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
      : gate === 'needMic'
        ? t('reading.startNeedsMic')
        : t('reading.startSession', { count: dlgIn });

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('reading.rangeHeading')}</Text>
        <Text style={styles.sub}>
          {script.title} · {t('reading.dialogueCount', { count: script.dialogueCount })}
        </Text>

        <Text style={styles.section}>{t('reading.myRolesLabel')}</Text>
        <Text style={styles.hint}>{t('reading.myRolesHint')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.roleChips}>
          {cast.map((c) => {
            const on = selected.includes(c.id);
            return (
              <Pressable key={c.id} style={[styles.roleChip, on && styles.roleChipOn]} onPress={() => toggleRole(c.id)}>
                {on && <Feather name="check" size={14} color={palette.blue} />}
                <Text style={[styles.roleChipText, on && styles.roleChipTextOn]}>{c.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.pickedRow}>
          <Text style={styles.pickedLabel}>{t('reading.pickedRoles')}</Text>
          {pickedCast.length === 0 ? (
            <Text style={styles.pickedNone}>{t('reading.pickedNone')}</Text>
          ) : (
            pickedCast.map((c) => (
              <Pressable key={c.id} style={styles.pickedChip} onPress={() => toggleRole(c.id)} hitSlop={4}>
                <Text style={styles.pickedChipText}>{c.name}</Text>
                <Feather name="x" size={12} color={palette.onAccent} />
              </Pressable>
            ))
          )}
        </View>

        <Text style={[styles.section, styles.sectionGap]}>{t('reading.rangeLabel')}</Text>
        <View style={styles.rangeBlock} ref={rangePickTarget.ref} onLayout={rangePickTarget.onLayout}>
          <View style={styles.tabs}>
            {tabs.map((k) => (
              <Pressable key={k} style={[styles.tab, activeTab === k && styles.tabOn]} onPress={() => setTab(k)}>
                <Text style={[styles.tabText, activeTab === k && styles.tabTextOn]}>{TAB_LABEL[k]}</Text>
              </Pressable>
            ))}
          </View>

          {activeTab === 'recent' && (
            <View style={styles.list}>
              {recents.map(({ card, range: r }) => {
                const active = isActive(r);
                const count = card.range.end_dialogue_no - card.range.start_dialogue_no + 1;
                return (
                  <Pressable key={card.id} style={[styles.recentRow, active && styles.rowIn]} onPress={() => pickRange(r)}>
                    <Text style={[styles.rowTitle, styles.recentTitle, active && styles.rowTitleOn]} numberOfLines={1}>
                      {rangeTitle(card.range_name, t)}
                    </Text>
                    <Text style={styles.recentMeta}>{t('reading.recentMeta', { count, session: `${t('reading.sessionOrdinal', { n: card.ordinal })} · ${relativeDay(card.started_at, Date.now())}` })}</Text>
                    {active && <Feather name="check" size={18} color={palette.blue} />}
                  </Pressable>
                );
              })}
            </View>
          )}

          {activeTab === 'scene' && (
            <View style={styles.list}>
              {scenes.map((s) => {
                const active = isActive(s);
                const first = lines[s.startIndex];
                return (
                  <Pressable key={s.no} style={[styles.sceneRow, active && styles.rowIn]} onPress={() => pickRange(s)}>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{sceneTitle(s, t)}</Text>
                      <Text style={styles.rowLine} numberOfLines={1}>
                        {t('reading.dialogueCount', { count: s.dialogue_count })} · {first?.type === 'dialogue' ? `${first.role} ${first.text}` : first?.text}
                      </Text>
                    </View>
                    {active && <Feather name="check" size={18} color={palette.blue} />}
                  </Pressable>
                );
              })}
            </View>
          )}

          {activeTab === 'line' && (
            <>
              <View style={styles.pickBar}>
                <Text style={styles.pickText}>{picking === 'start' ? t('reading.pickStart') : t('reading.pickEnd')}</Text>
                <Pressable onPress={() => pickRange(whole)} hitSlop={8}>
                  <Text style={styles.pickReset}>{t('reading.pickAll')}</Text>
                </Pressable>
              </View>
              <View style={styles.list}>
                {dialogues.map(({ l, i }) => {
                  const inRange = i >= range.startIndex && i <= range.endIndex;
                  const isStart = i === range.startIndex;
                  const isEnd = i === range.endIndex;
                  return (
                    <Pressable key={i} style={[styles.row, inRange && styles.rowIn]} onPress={() => pickLine(i)}>
                      <Text style={styles.rowNo}>{numbers[i]}</Text>
                      <View style={styles.rowBody}>
                        <Text style={styles.rowTitle}>{l.type === 'dialogue' ? l.role : ''}</Text>
                        <Text style={styles.rowLine} numberOfLines={1}>{l.text}</Text>
                      </View>
                      {isStart && (
                        <View style={styles.tag}>
                          <Text style={styles.tagText}>{t('reading.pickTagStart')}</Text>
                        </View>
                      )}
                      {isEnd && !isStart && (
                        <View style={[styles.tag, styles.tagEnd]}>
                          <Text style={styles.tagText}>{t('reading.pickTagEnd')}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.maskRow}>
          {MASKS.map((m) => (
            <Pressable key={m.key} style={[styles.maskChip, mask === m.key && styles.maskChipOn]} onPress={() => setMask(m.key)}>
              <Text style={[styles.maskText, mask === m.key && styles.maskTextOn]} numberOfLines={1}>
                {m.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {micGranted === false && (
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
        <Pressable
          ref={rangeStartTarget.ref}
          onLayout={rangeStartTarget.onLayout}
          style={[styles.primary, (gate !== 'ready' || busy) && styles.primaryOff]}
          onPress={onStart}
          disabled={gate !== 'ready' || busy}>
          <Text style={styles.primaryText}>{startLabel}</Text>
        </Pressable>
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
  content: { padding: 20, gap: 10 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 2 },
  sub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, marginBottom: 8 },
  section: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  sectionGap: { marginTop: 8 },
  hint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12, marginTop: -6 },
  bleed: { marginHorizontal: -20 },
  roleChips: { gap: 8, paddingHorizontal: 20 },
  roleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderColor: palette.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: palette.card },
  roleChipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  roleChipText: { color: palette.text, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  roleChipTextOn: { color: palette.blueDeep },
  pickedRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  pickedLabel: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 12, marginRight: 2 },
  pickedNone: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 12 },
  pickedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  pickedChipText: { color: palette.onAccent, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
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
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg, gap: 10 },
  maskRow: { flexDirection: 'row', gap: 6 },
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
