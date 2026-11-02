import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { Image } from 'expo-image';
import { ReadingNoScript } from '@/components/reading/no-script';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT as MASCOT_IMG, MASCOT_SIZE } from '@/components/ui/mascot';
import { useAppDialog } from '@/components/app-dialog';
import { BlueSwitch } from '@/components/ui/list-rows';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { TARGET } from '@/lib/spotlight-targets';
import { micPermissionState, requestMicPermission, type MicPermission } from '@/hooks/use-reading-mic';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import {
  buildStartBody,
  defaultMyCharacterIds,
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
import { getCurrent, getCurrentSession, listSessions, startSession, updateCurrent, type MaskMode } from '@/lib/reading/store';
import { setFirstReadingSession } from '@/lib/reading/first-reading';
import { useCloudVoice } from '@/hooks/use-cloud-voice';
import * as engine from '@/lib/reading/tts/engine';
import type { ScriptLine, SessionCard } from '@/lib/reading/types';
import { newRequestId } from '@/lib/request-id';
import { relativeDay } from '@/lib/reading/script-cards';
import { translate as t } from '@/lib/i18n';
import { logEvent } from '@/lib/analytics';
import { DEFAULT_LISTEN_PREFS, PAUSE_MAX_SEC, PAUSE_MIN_SEC, READING_RATES, loadListenPrefs, parsePause, rateLabel, saveListenPrefs, type ListenPrefs } from '@/lib/reading/listen-prefs';
import { TextField } from '@/components/ui/text-field';

/**
 * 새 연습(R8, reading.cast · reading.session). 연습마다 ① 내 배역(여러 명, 나머지는 앱이 읽음) ② 구간(최근 구간 ·
 * 장면으로 찾기 · 대사로 찾기) ③ 대사 보기(기기가 대본마다 마지막 값을 기억)를 정하고 "시작"을 누를 때 회차를 한 번
 * 만든다. 방식은 읽어주기 하나이고 녹음은 늘 하므로 마이크 권한이 없으면 시작하지 못한다(R8.7).
 * 회차 상세 「이 구간으로 다시 연습」은 params roles(쉼표로 이은 배역 id)·start·end(줄 id)로 그 배역·구간을 골라 둔다.
 */

type Tab = 'recent' | 'scene' | 'line';
// 그릴 때 번역한다 — 언어를 바로 바꿀 수 있게(lib/i18n onLanguageChange).
const tabLabel = (k: Tab): string => ({
  recent: t('reading.byRecent'),
  scene: t('reading.byScene'),
  line: t('reading.byLine'),
})[k];

const NO_LINES: ScriptLine[] = [];

export default function ReadingRange() {
  const router = useRouter();
  const params = useLocalSearchParams<{ roles?: string; start?: string; end?: string; first?: string }>();
  /**
   * 첫 리딩 모드(10/29) — 리딩을 한 번도 끝내지 않은 계정이 대본을 막 넣고 왔다. 「어떤 배역을 읽으실 건가요?」 하나만 묻고
   * 대사 보기·구간은 고르지 않는다(대본 전체를 처음부터, 대사는 다 보인다). 독백이면 배역도 묻지 않고 바로 시작한다.
   */
  const firstMode = params.first === '1';
  const { alert, confirm, dialog } = useAppDialog();
  const { askFirstReading, consentSheet } = useCloudVoice();
  const script = getCurrent();
  const lines = script?.lines ?? NO_LINES;
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
  const [mask, setMask] = useState<MaskMode>(firstMode ? 'none' : (script?.maskMode ?? 'none'));
  /** 회차 목록. null 은 불러오는 중. */
  const [sessions, setSessions] = useState<SessionCard[] | null>(hasHistory ? null : []);
  /** null 은 확인 중. 묻는 건 [시작]을 누를 때다(SOMA-772). */
  const [mic, setMic] = useState<MicPermission | null>(null);
  const [busy, setBusy] = useState(false);
  /** 핸즈프리·읽는 속도(SOMA-952·954) — 이 기기에 남긴 마지막 선택. */
  const [listen, setListen] = useState<ListenPrefs>(DEFAULT_LISTEN_PREFS);
  /** 쉬는 시간 입력칸의 글 — 바른 값일 때만 설정에 넣는다. */
  const [pauseText, setPauseText] = useState(String(DEFAULT_LISTEN_PREFS.pauseSec));
  const pauseInvalid = parsePause(pauseText) === null;
  useEffect(() => {
    let alive = true;
    void loadListenPrefs().then((p) => {
      if (!alive) return;
      setListen(p);
      setPauseText(String(p.pauseSec));
    });
    return () => {
      alive = false;
    };
  }, []);
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

  // 상대역 목소리를 미리 준비한다 — 받아 둔 모델은 메모리에 올리고(첫 미리 듣기·실행 화면이 기다리지 않게), 없으면 Wi-Fi 에서만 받는다. 화면을 막지 않고 실패도 알리지 않는다.
  // 예시에서 온 대본(sample)은 미리 만든 음성으로 읽을 수 있어 받지 않는다 — 서버 답을 기다리면 받기와 엇갈려 입력 경로로 정한다.
  const fromSample = script?.source === 'sample';
  useEffect(() => {
    if (!fromSample) void engine.prepareInBackground();
  }, [fromSample]);

  const recents = useMemo(
    () =>
      recentRanges(sessions ?? []).flatMap((card) => {
        const range = rangeOfDialogueNos(lines, card.range.start_dialogue_no, card.range.end_dialogue_no);
        return range ? [{ card, range }] : [];
      }),
    [sessions, lines],
  );

  // 첫 리딩 모드의 독백은 고를 배역이 없다 — 마이크 상태를 안 뒤 한 번 바로 시작한다(권한 창·고품질 목소리 동의는 그대로 뜬다).
  const startRef = useRef<(() => void) | null>(null);
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!firstMode || cast.length !== 1 || mic === null || autoStarted.current) return;
    autoStarted.current = true;
    startRef.current?.();
  }, [firstMode, cast.length, mic]);

  if (!script) return <ReadingNoScript />;

  const whole = snapRangeToDialogues(lines, 0, lines.length - 1) ?? { startIndex: 0, endIndex: Math.max(0, lines.length - 1) };
  const pickedCast = cast.filter((c) => selected.includes(c.id));
  // 내 차례로 읽는 배역 — 고른 배역과 그 배역이 든 함께 말하는 줄의 묶음 배역(play 와 같은 turnRoles, SOMA-709·785).
  const myTurnRoles = turnRoles(script.characters, pickedCast.map((c) => c.id));
  // 첫 연습도 전체가 기본이다 — 예전엔 처음 대사 10줄을 짧은 구간으로 골라 뒀는데, 이제 리딩 화면이 10줄씩 끊어 보인다(SOMA-934).
  const range = firstMode ? whole : (picked ?? recents[0]?.range ?? whole);
  const showRecent = hasHistory && (sessions === null || recents.length > 0);
  const tabs: Tab[] = showRecent ? ['recent', 'scene', 'line'] : ['scene', 'line'];
  const activeTab = tab && tabs.includes(tab) ? tab : tabs[0];
  const isActive = (r: LineRange) => r.startIndex === range.startIndex && r.endIndex === range.endIndex;
  const dlgIn = dialogues.filter((x) => x.i >= range.startIndex && x.i <= range.endIndex).length;
  // 고른 배역의 대사가 구간 안에 거의 없으면 처음 안내 대신 알린다 — 시작은 막지 않는다(SOMA-709).
  const few = fewLines(lines, myTurnRoles, range.startIndex, range.endIndex);
  const loadingDefault = !firstMode && picked === null && sessions === null;
  // 내 배역을 하나도 고르지 않으면 「전체 듣기」 — 앱이 모든 대사를 읽는다(1.1.1). 첫 리딩은 지금처럼 배역을 고른다.
  const listenAll = !firstMode && selected.length === 0;
  // 핸즈프리는 상대 대사가 있는 대본에서만 — 독백은 내 대사뿐이라 쉬기만 하게 된다.
  const handsFree = !firstMode && !listenAll && cast.length > 1 && listen.handsFree;
  // 전체 듣기·핸즈프리는 마이크를 열지 않는다 — 권한을 묻지 않는다.
  const needsMic = !listenAll && !handsFree;
  const gate = startGate({
    roleCount: listenAll ? 1 : selected.length,
    micGranted: !needsMic ? true : mic === null ? null : true,
    loading: loadingDefault,
  });
  const updateListen = (next: Partial<ListenPrefs>) =>
    setListen((prev) => {
      const merged = { ...prev, ...next };
      void saveListenPrefs(merged);
      return merged;
    });

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
    if (!listenAll && rangeError(lines, myRoles, range.startIndex, range.endIndex)) {
      void alert({ title: t('reading.startFailed'), message: t('reading.errorEmptyRange') });
      return;
    }
    if (needsMic && mic !== 'granted') {
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
      // 무료 배우의 대본 첫 리딩이면 시작 전에 고품질 목소리 동의를 한 번 받는다(SOMA-917). 거절해도 기기 목소리로 그대로 시작한다.
      await askFirstReading(script.id);
      await startSession(
        script.id,
        buildStartBody({
          requestId: requestId.current,
          myCharacterIds: selected,
          startLineId: script.lineIds[range.startIndex],
          endLineId: script.lineIds[range.endIndex],
          // 전체 듣기·핸즈프리는 말하지 않으니 녹음도 하지 않는다. 핸즈프리는 대사 길이만큼 쉬고 넘어간다(timed).
          advance: listenAll ? 'manual' : handsFree ? 'timed' : 'silence',
          record: needsMic,
        }),
      );
      void logEvent('reading_listen_options', { listen_all: listenAll, hands_free: handsFree, rate: listen.rate, pause_sec: handsFree ? listen.pauseSec : 0 });
      await updateCurrent({ maskMode: mask });
      setFirstReadingSession(firstMode ? (getCurrentSession()?.id ?? null) : null);
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

  startRef.current = () => void onStart();
  const mono = cast.length === 1;
  const firstRun = !hasHistory;
  const micAsk = needsMic && mic !== 'granted';
  const mainLabel = busy
    ? t('reading.startingSession')
    : firstMode
      ? t('reading.firstPickStart')
      : gate === 'pickRole'
      ? t('reading.startNeedsRole')
      : listenAll
        ? t('reading.startListenAll', { count: dlgIn })
      : micAsk
        ? t('reading.startWithMic')
        : t('reading.startSession', { count: dlgIn });
  const dialogueCountIn = (r: LineRange) => dialogues.filter((x) => x.i >= r.startIndex && x.i <= r.endIndex).length;
  const firstDialogueIn = (r: LineRange) => dialogues.find((x) => x.i >= r.startIndex && x.i <= r.endIndex)?.l as Extract<ScriptLine, { type: 'dialogue' }> | undefined;
  /** pen 구간 카드: 제목 한 줄 + 보조 한 줄, 고른 카드는 파란 안개 배경과 체크. */
  const renderRangeCard = (key: string, title: string, sub: string, r: LineRange) => {
    const on = isActive(r);
    return (
      <Pressable key={key} style={[styles.card, on && styles.cardOn]} onPress={() => pickRange(r)} accessibilityRole="radio" accessibilityState={{ checked: on }}>
        <View style={styles.rowBody}>
          <Text style={[styles.cardTitle, on && styles.titleOn]}>{title}</Text>
          <Text style={styles.cardSub} numberOfLines={1}>{sub}</Text>
        </View>
        {on && <Feather name="check-circle" size={22} color={palette.blue} />}
      </Pressable>
    );
  };
  /** pen R8.6 최근 구간 카드: 제목과 「N개 · M회차 · 날짜」를 한 줄에, 고른 카드는 파란 테두리·파란 제목. */
  const renderRecentCard = (key: string, title: string, meta: string, r: LineRange) => {
    const on = isActive(r);
    return (
      <Pressable key={key} style={[styles.recentRow, on && styles.recentRowOn]} onPress={() => pickRange(r)} accessibilityRole="radio" accessibilityState={{ checked: on }}>
        <Text style={[styles.recentTitle, on && styles.titleOn]} numberOfLines={1}>{title}</Text>
        <Text style={styles.recentMeta} numberOfLines={1}>{meta}</Text>
        {on && <Feather name="check-circle" size={22} color={palette.blue} />}
      </Pressable>
    );
  };
  const wholeCard = renderRangeCard('whole', t('reading.rangeAll'), t('reading.dialogueCount', { count: dialogueCountIn(whole) }), whole);
  const sceneCards = scenes.map((sc) => {
    const first = firstDialogueIn(sc);
    const sub = `${t('reading.dialogueCount', { count: dialogueCountIn(sc) })}${first ? ` · ${first.role} ${first.text}` : ''}`;
    return renderRangeCard(`scene${sc.no}`, sceneTitle(sc, t), sub, sc);
  });

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* pen R8.3~R8.6 — 마스코트 + 큰 제목, 「내 배역」 알약, 대사 보기 칩, 「구간」 탭(최근 연습·추천 / 장면으로 찾기 / 대사로 찾기). */}
        <View style={styles.mascotRow}>
          <Image source={MASCOT_IMG.reading} style={MASCOT_SIZE.sm} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
          <View style={styles.bubble}>
            <Text style={styles.title}>{t(firstMode ? 'reading.firstPickTitle' : 'reading.rangeHeading')}</Text>
            <Text style={styles.sub}>{firstMode ? t('reading.firstPickSub') : firstRun && micAsk ? t('reading.rangeFirstGuide') : `${script.title} · ${t('reading.dialogueCount', { count: script.dialogueCount })}`}</Text>
          </View>
        </View>

        {firstMode ? (
          <>
          {/* 첫 리딩 — 대본을 먼저 보여 주고 그 아래에서 배역을 고른다(11/2 우영: 대본을 보면서 골라야 한다). 고른 배역의 대사는 진하게 보인다. */}
          <View style={styles.preview} accessibilityLabel={t('reading.firstPreviewA11y')}>
            <ScrollView nestedScrollEnabled style={styles.previewScroll} contentContainerStyle={styles.previewBody}>
              {lines.map((l, i) => {
                if (l.type !== 'dialogue') {
                  return (
                    <Text key={i} style={l.type === 'scene' ? styles.previewScene : styles.previewDirection}>
                      {l.text}
                    </Text>
                  );
                }
                const mine = cast.some((c) => c.name === l.role && selected.includes(c.id));
                return (
                  <View key={i} style={styles.previewLine}>
                    <Text style={[styles.previewRole, mine && styles.previewRoleOn]}>{l.role}</Text>
                    <Text style={[styles.previewText, mine && styles.previewTextOn]}>{l.text}</Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
          <Text style={styles.section}>{t('reading.firstPickBelow')}</Text>
          <View ref={rangePickTarget.ref} onLayout={rangePickTarget.onLayout} style={styles.list}>
            {cast.map((c) => {
              const on = selected.includes(c.id);
              // 대본이 바로 위에 보이니 카드에는 대사 수만 둔다.
              const sub = t('reading.dialogueCount', { count: roleLineCount(c, lines, script.characters) });
              return (
                <Pressable
                  key={c.id}
                  style={[styles.card, on && styles.cardOn]}
                  onPress={() => toggleRole(c.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  ph-label="reading_first_role">
                  <View style={styles.rowBody}>
                    <Text style={styles.cardTitle}>{c.name}</Text>
                    <Text style={styles.cardSub} numberOfLines={1}>{sub}</Text>
                  </View>
                  {on && <Feather name="check" size={18} color={palette.blue} />}
                </Pressable>
              );
            })}
          </View>
          </>
        ) : (
          <>
        <Text style={styles.section}>{t('reading.myRolesLabel')}</Text>
        {/* pen R8.6 「칩 줄」 — 배역이 많으면 옆으로 민다. */}
        <View ref={rangePickTarget.ref} onLayout={rangePickTarget.onLayout} style={styles.bleed}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {cast.map((c) => {
            const on = selected.includes(c.id);
            return (
              <Pressable
                key={c.id}
                style={[styles.roleChip, on && styles.roleChipOn]}
                onPress={() => toggleRole(c.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}>
                <Text style={[styles.roleChipText, on && styles.roleChipTextOn]}>{c.name}</Text>
                {!mono && <Text style={styles.roleChipCount}>{roleLineCount(c, lines, script.characters)}</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
        </View>
        {/* 대사가 한 줄뿐인 대본은 한 번에 읽게 된다 — 나눠 읽는 길을 같은 안내 자리에 알린다(SOMA-727, 팝업 없음). */}
        <Text style={styles.hint}>
          {listenAll && !mono
            ? t('reading.listenAllNote')
            : dialogues.length === 1
            ? t('reading.rangeSingleLineNote')
            : mono
              ? t('reading.monologueCard', { count: script.dialogueCount })
              : t('reading.rangeMultiNote')}
        </Text>

        {/* 가리기는 「내 대사 가리기」 스위치 하나다(UX 가이드 10절 리딩, 10/23). 칩 셋이 오른쪽에서 잘렸다(10/28 폰 확인).
            「모두 가리기」는 리딩 화면의 눈 버튼으로 바꿀 수 있다. */}
        {!listenAll && (
          <View style={styles.maskRow}>
            <Text style={styles.maskLabel}>{t('reading.maskMineSwitch')}</Text>
            <BlueSwitch
              value={mask !== 'none'}
              onValueChange={(on) => setMask(on ? 'mine' : 'none')}
              accessibilityLabel={t('reading.maskMineSwitch')}
            />
          </View>
        )}
        {/* 자동 넘김(SOMA-954) — 걸으면서 듣게. 내 차례에 마이크를 열지 않고 고른 시간만큼 쉬고 넘어간다. 팝업 없이 스위치 한 줄. */}
        {!listenAll && cast.length > 1 && (
          <View style={styles.maskRow}>
            <View style={styles.rowBody}>
              <Text style={styles.maskLabel}>{t('reading.handsFreeSwitch')}</Text>
              <Text style={styles.hint}>{t('reading.handsFreeDesc')}</Text>
            </View>
            <BlueSwitch
              value={listen.handsFree}
              onValueChange={(on) => updateListen({ handsFree: on })}
              accessibilityLabel={t('reading.handsFreeSwitch')}
            />
          </View>
        )}
        {/* 자동 넘김을 켜면 쉬는 시간을 적는다(기본 2초, 0.5~30초, 11/1 사용자 결정: 버튼 말고 입력). */}
        {handsFree && (
          <View style={styles.maskRow}>
            <Text style={styles.maskLabel}>{t('reading.pauseLabel')}</Text>
            <View style={styles.pauseInput}>
              <TextField
                value={pauseText}
                onChangeText={(text) => {
                  setPauseText(text);
                  const sec = parsePause(text);
                  if (sec !== null) updateListen({ pauseSec: sec });
                }}
                // 틀린 채로 칸을 떠나면 마지막 바른 값으로 되돌린다.
                onBlur={() => pauseInvalid && setPauseText(String(listen.pauseSec))}
                keyboardType="decimal-pad"
                maxLength={4}
                selectTextOnFocus
                accessibilityLabel={t('reading.pauseLabel')}
                // 아래 안내 줄은 키보드에 가려진다 — 틀린 값이면 칸 테두리부터 빨갛게(11/1 폰 확인).
                style={[styles.pauseField, pauseInvalid && styles.pauseFieldError]}
              />
              <Text style={styles.maskLabel}>{t('reading.pauseUnit')}</Text>
            </View>
          </View>
        )}
        {handsFree && pauseInvalid && <Text style={styles.hint}>{t('reading.pauseRange', { min: PAUSE_MIN_SEC, max: PAUSE_MAX_SEC })}</Text>}
        {/* 읽는 속도(SOMA-952) — 앱이 읽는 모든 목소리에 같이 든다. */}
        <View style={styles.maskRow}>
          <Text style={styles.maskLabel}>{t('reading.rateLabel')}</Text>
          <View style={styles.rateRow}>
            {READING_RATES.map((r) => {
              const on = listen.rate === r;
              return (
                <Pressable
                  key={r}
                  style={[styles.rateChip, on && styles.rateChipOn]}
                  onPress={() => updateListen({ rate: r })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={t('reading.rateA11y', { rate: t('reading.rateValue', { rate: rateLabel(r) }) })}>
                  <Text style={[styles.roleChipText, on && styles.roleChipTextOn]}>{t('reading.rateValue', { rate: rateLabel(r) })}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text style={[styles.section, styles.sectionRange]}>{t('reading.rangeSection')}</Text>
        {mono ? (
          <View style={styles.list}>{wholeCard}</View>
        ) : (
          <>
            <View style={styles.tabs}>
              {tabs.map((k) => {
                const on = activeTab === k;
                return (
                  <Pressable key={k} style={[styles.tab, on && styles.tabOn]} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                    <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={2}>{tabLabel(k)}</Text>
                  </Pressable>
                );
              })}
            </View>

            {activeTab === 'recent' && (
              <View style={styles.list}>
                {recents.map(({ card, range: r }) =>
                  renderRecentCard(
                    `recent${card.id}`,
                    rangeTitle(card.range_name, t),
                    t('reading.recentMeta', {
                      count: dialogueCountIn(r),
                      session: `${t('reading.sessionOrdinal', { n: card.ordinal })} · ${relativeDay(card.started_at, Date.now())}`,
                    }),
                    r,
                  ),
                )}
                {!recents.some((x) => x.range.startIndex === whole.startIndex && x.range.endIndex === whole.endIndex) && wholeCard}
              </View>
            )}
            {activeTab === 'scene' && <View style={styles.list}>{scenes.length > 0 ? sceneCards : wholeCard}</View>}
            {activeTab === 'line' && (
              <View style={styles.list}>
                <View style={styles.pickBar}>
                  <Text style={styles.pickText}>{picking === 'start' ? t('reading.pickStart') : t('reading.pickEnd')}</Text>
                  <Pressable onPress={() => pickRange(whole)} hitSlop={8}>
                    <Text style={styles.pickReset}>{t('reading.pickAll')}</Text>
                  </Pressable>
                </View>
                {dialogues.map(({ l, i }) => {
                  const inside = i >= range.startIndex && i <= range.endIndex;
                  const dl = l as Extract<ScriptLine, { type: 'dialogue' }>;
                  return (
                    <Pressable key={i} style={[styles.lineRow, inside && styles.lineRowIn]} onPress={() => pickLine(i)} accessibilityRole="button">
                      <Text style={styles.lineRole} numberOfLines={1}>{dl.role}</Text>
                      <Text style={styles.lineText} numberOfLines={1}>{dl.text}</Text>
                      {i === range.startIndex && (
                        <View style={styles.tag}>
                          <Text style={styles.tagText}>{t('reading.pickTagStart')}</Text>
                        </View>
                      )}
                      {i === range.endIndex && range.endIndex !== range.startIndex && (
                        <View style={[styles.tag, styles.tagEnd]}>
                          <Text style={styles.tagText}>{t('reading.pickTagEnd')}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}
        {few !== null && (
          <View style={styles.fewRow}>
            <Feather name="info" size={16} color={palette.amber} />
            <Text style={styles.fewText}>{t('reading.rangeFewShort', { roles: pickedCast.map((c) => c.name).join(', '), count: few })}</Text>
          </View>
        )}

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
          </>
        )}
      </ScrollView>

      <CtaBar>
        {mic === 'blocked' && (
          <View style={styles.micBox}>
            <Feather name="mic-off" size={20} color={palette.amber} />
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
      </CtaBar>
      {dialog}
      {consentSheet}
      {tutorialGuide.element}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  content: { paddingHorizontal: space.gutter, paddingTop: space[4], paddingBottom: space[6], gap: space[3] },
  mascotRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  bubble: { flex: 1, gap: space[1] },
  title: { ...type.title2, color: palette.text },
  sub: { ...type.caption, color: palette.textMeta },
  section: { ...type.body2Bold, color: palette.textSub, marginTop: space[2] },
  sectionRange: { marginTop: space[2] },
  hint: { ...type.caption, color: palette.textMeta },
  bleed: { marginHorizontal: -space.gutter },
  maskRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  maskLabel: { ...type.body1, color: palette.text },
  rateRow: { flexDirection: 'row', gap: space[1.5] },
  pauseInput: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  pauseField: { width: 72, minHeight: 40, textAlign: 'center' },
  pauseFieldError: { borderWidth: 1.5, borderColor: palette.danger },
  rateChipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue, borderWidth: 1.5 },
  rateChip: { alignItems: 'center', justifyContent: 'center', minHeight: 36, minWidth: 48, borderRadius: radius.full, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg, paddingHorizontal: space[2] },
  chipRow: { gap: space[2], paddingHorizontal: space.gutter },
  roleChip: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], minHeight: 40, borderRadius: radius.full, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg, paddingHorizontal: space[4] },
  roleChipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue, borderWidth: 1.5, paddingHorizontal: space[4] - 0.5 },
  roleChipText: { ...type.body2Bold, color: palette.textSub },
  roleChipTextOn: { color: palette.blueDeep },
  roleChipCount: { ...type.body2, color: palette.textMeta },
  tabs: { flexDirection: 'row', backgroundColor: palette.bgSoft, borderRadius: radius.md, padding: space[1], gap: space[1] },
  // 높이를 못 박지 않는다 — 탭 글자가 두 줄로 꺾이면 탭 줄이 함께 늘어난다(새 대본 탭과 같다).
  tab: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, paddingVertical: space[1.5] },
  tabOn: { backgroundColor: palette.bg },
  tabText: { ...type.body2Bold, color: palette.textMeta, textAlign: 'center' },
  tabTextOn: { color: palette.text },
  list: { gap: space[3] },
  preview: { borderRadius: radius.lg, backgroundColor: palette.bgSoft, overflow: 'hidden' },
  previewScroll: { maxHeight: 320 },
  previewBody: { padding: space[4], gap: space[3] },
  previewScene: { ...type.captionBold, color: palette.textMeta },
  previewDirection: { ...type.caption, color: palette.textMeta, fontStyle: 'italic' },
  previewLine: { gap: 2 },
  previewRole: { ...type.captionBold, color: palette.textSub },
  previewRoleOn: { color: palette.blue },
  previewText: { ...type.body2, color: palette.textSub },
  previewTextOn: { ...type.body2Bold, color: palette.text },
  card: { flexDirection: 'row', alignItems: 'center', gap: space[2], backgroundColor: palette.bg, borderColor: palette.border, borderWidth: 1, borderRadius: radius.lg, padding: space[4] },
  cardOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue, borderWidth: 1.5, padding: space[4] - 0.5 },
  rowBody: { flex: 1, gap: space[1] },
  cardTitle: { ...type.body1Bold, color: palette.text },
  titleOn: { color: palette.blueDeep },
  cardSub: { ...type.caption, color: palette.textMeta },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], backgroundColor: palette.bg, borderColor: palette.border, borderWidth: 1, borderRadius: radius.lg, padding: space[4] },
  recentRowOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue, borderWidth: 1.5, padding: space[4] - 0.5 },
  recentTitle: { flex: 1, ...type.body1Bold, color: palette.text },
  recentMeta: { ...type.caption, color: palette.textMeta },
  pickBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.blueSoft, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: space[2] },
  pickText: { ...type.captionBold, color: palette.blueDeep },
  pickReset: { ...type.captionBold, color: palette.textSub },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: palette.bg, borderColor: palette.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: space[3], paddingHorizontal: space[4] },
  lineRowIn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  lineRole: { ...type.body2Bold, color: palette.text, width: 44 },
  lineText: { flex: 1, ...type.caption, color: palette.textMeta },
  tag: { backgroundColor: palette.blue, borderRadius: radius.full, paddingHorizontal: space[2], paddingVertical: 2 },
  tagEnd: { backgroundColor: palette.textSub },
  tagText: { ...type.micro, color: palette.onAccent },
  fewRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], backgroundColor: palette.amberSoft, borderRadius: radius.md, padding: space[4] },
  fewText: { flex: 1, ...type.captionBold, color: palette.amber },
  howBox: { gap: space[2], marginTop: space[2], backgroundColor: palette.bgSubtle, borderRadius: radius.lg, padding: space[4] },
  howTitle: { ...type.body2Bold, color: palette.text },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  howDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: palette.blue },
  howText: { flex: 1, ...type.body2, color: palette.textSub },
  micBox: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: palette.amberSoft, borderRadius: radius.lg, padding: space[4] },
  micTitle: { ...type.body2Bold, color: palette.amber },
  micBody: { ...type.caption, color: palette.amber },
  micLink: { ...type.body2Bold, color: palette.blueDeep },
});
