import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { readHomeSnapshot, writeHomeSnapshot } from '@/lib/home-snapshot';
import { markHomeReady } from '@/lib/launch-splash';
import { buildRecentActivity, withPracticeCounts, type ActivityDay } from '@/lib/practice-activity';
import { rememberPracticeDays, serverPracticeDayRecords, sessionPracticeDays, subscribeSessionPracticeDays } from '@/lib/practice-days';
import { countedPractices, type CountedPractice } from '@/lib/practice/counted';
import { firstTimeStateFrom, setFirstTimeState, shouldRememberGraduation, subscribeFirstTimeState, type FirstTimeState } from '@/lib/practice/first-time';
import { currentFirstUseOwner, graduatedInMemory, hasGraduatedFirstUse, markFirstUseGraduated } from '@/lib/practice/first-use-graduation';
import { practiceDayTotal, practiceStreak } from '@/lib/practice/groups';
import type { PracticeGroup } from '@/lib/practice/types';
import type { ScriptCard } from '@/lib/reading/types';

/** 리딩 회차를 읽을 대본 — 최근 14일 안에 연습한 것만(연속일·주간 원에 쓰는 만큼). */
const READING_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
function recentlyPracticedScripts(scripts: readonly ScriptCard[], now = Date.now()): ScriptCard[] {
  return scripts.filter((s) => {
    const at = Date.parse(s.last_practiced_at ?? '');
    return Number.isFinite(at) && now - at <= READING_LOOKBACK_MS;
  });
}

/** 첫 사용자인지 따질 때만 더 보는 대본 — 14일보다 전에 읽은 것, 최근에 읽은 순으로 몇 개만(11/2). */
const OLDER_READING_CHECK_LIMIT = 10;
function olderPracticedScripts(scripts: readonly ScriptCard[], now = Date.now()): ScriptCard[] {
  return scripts
    .filter((s) => {
      const at = Date.parse(s.last_practiced_at ?? '');
      return Number.isFinite(at) && now - at > READING_LOOKBACK_MS;
    })
    .sort((a, b) => Date.parse(b.last_practiced_at ?? '') - Date.parse(a.last_practiced_at ?? ''))
    .slice(0, OLDER_READING_CHECK_LIMIT);
}

export type PracticeRecords = {
  /** 묶음·대본·연습한 날·졸업 표시를 다 읽었나. */
  loaded: boolean;
  firstTime: FirstTimeState;
  /** 연습한 날을 한 번이라도 받았나 — 받기 전엔 연속일(0)로 축하를 따지지 않는다. */
  activityLoaded: boolean;
  /** 대본 목록·리딩 회차·참여작 중 못 받은 것이 있다. */
  recordsFailed: boolean;
  /** 오늘이 맨 오른쪽인 최근 7일 — 연습한 날 기록만으로 센 것(연속일 축하 점). */
  recentDays: ActivityDay[];
  /** 같은 7일에 그날 센 연습(코칭·리딩·챌린지) 수를 넣은 것(이번 주 원). */
  weekDays: ActivityDay[];
  weekPracticedDays: number;
  streak: number;
  totalDays: number;
  practicedToday: boolean;
  practices: CountedPractice[];
  /** 맨 위에서 당길 때 — 기록만 다시 읽는다. */
  refresh: () => Promise<void>;
};

const EMPTY: PracticeRecords = {
  loaded: false,
  firstTime: 'unknown',
  activityLoaded: false,
  recordsFailed: false,
  recentDays: buildRecentActivity([]).days,
  weekDays: buildRecentActivity([]).days,
  weekPracticedDays: 0,
  streak: 0,
  totalDays: 0,
  practicedToday: false,
  practices: [],
  refresh: async () => undefined,
};

const PracticeRecordsContext = createContext<PracticeRecords>(EMPTY);

/** 탭 화면이 읽는 연습 기록(이번 주 원·연속일·첫 사용자). 탭 레이아웃 밖이면 받기 전 상태다. */
export function usePracticeRecords(): PracticeRecords {
  return useContext(PracticeRecordsContext);
}

/**
 * 연습 기록 공급자(SOMA-1120 — 예전 홈 화면이 하던 일). 탭 레이아웃이 감싸고, 탭 묶음이 보일 때마다(다른 화면에서 돌아올 때 포함)
 * 연습 묶음·대본·리딩 회차·참여작·서버 연습일을 읽어 「연습 1회」로 센다(SOMA-773).
 *
 * - 첫 사용자 판정(lib/practice/first-time)과 졸업 표시(first-use-graduation)를 여기서 정한다 — 판단은 이 한 곳이다.
 * - 앱을 켤 때 지난번 기록(lib/home-snapshot)을 먼저 쓰고, 다 받으면 로고를 닫게 알린다(lib/launch-splash markHomeReady).
 * - 동의·프로필 게이트가 열리는 순간 다시 읽는다(오프라인으로 켠 기기, 11/2 폰 QA).
 */
export function PracticeRecordsProvider({ children }: { children: ReactNode }) {
  const { user, consentEntry, profile } = useAuth();
  const [groups, setGroups] = useState<PracticeGroup[]>([]);
  /** 이번에 서버에서 기록을 새로 받았나 — 받았으면 기기에 남긴 지난번 기록으로 덮지 않는다. */
  const freshRecords = useRef(false);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupsFailed, setGroupsFailed] = useState(false);
  const [recordsFailed, setRecordsFailed] = useState(false);
  const [scripts, setScripts] = useState<ScriptCard[] | null>(null);
  // 연속일·주간 원용 날짜 — 서버 기록 ∪ 기기에 누적된 연습일(지워도 남는다). null 이면 아직 한 번도 못 받았다.
  const [activityDays, setActivityDays] = useState<{ created_at: string }[] | null>(null);
  /** 이 기기에서 리딩·코칭을 끝까지 해 본 계정인가(SOMA-827). 읽기 전엔 null. */
  const [graduated, setGraduated] = useState<boolean | null>(null);
  const [practices, setPractices] = useState<CountedPractice[]>([]);
  const meId = profile.me?.id ?? null;
  // 코칭 끝·리딩 끝 화면이 졸업을 적으면 바로 다시 그린다(SOMA-1075).
  const graduatedSignal = useSyncExternalStore(subscribeFirstTimeState, () => graduatedInMemory(meId));
  // 이번 실행에서 막 끝낸 코칭의 날 — 서버 기록을 다시 받기 전에도 연속일에 센다.
  const sessionDays = useSyncExternalStore(subscribeSessionPracticeDays, () => sessionPracticeDays(meId));

  const [graduationCheck, setGraduationCheck] = useState(0);
  useFocusEffect(useCallback(() => setGraduationCheck((n) => n + 1), []));
  useEffect(() => {
    if (!meId) return;
    let live = true;
    void hasGraduatedFirstUse(meId).then((done) => {
      if (live) setGraduated(done);
    });
    return () => {
      live = false;
    };
  }, [meId, graduationCheck]);

  // 마지막 기록 읽기 — 이 계정으로 다 받았으면 true. 게이트가 열릴 때 다시 읽을지 정한다(아래 gateOpen).
  const recordsRead = useRef<Promise<boolean>>(Promise.resolve(false));
  const loadRecords = useCallback((isCancelled: () => boolean) => {
    let groupsOk = true;
    const groupsRead = api
      .listPracticeGroups('all')
      .then((r) => {
        if (isCancelled()) return r.groups;
        setGroups(r.groups);
        setGroupsFailed(false);
        setGroupsLoaded(true);
        return r.groups;
      })
      .catch(() => {
        groupsOk = false;
        if (!isCancelled()) {
          setGroups([]);
          setGroupsFailed(true);
          setGroupsLoaded(true);
        }
        return [] as PracticeGroup[];
      });
    let readFailed = false;
    const scriptsRead = Promise.resolve()
      .then(() => api.listReadingScripts())
      .then((r) => {
        if (!isCancelled()) setScripts(r.scripts);
        return r.scripts;
      })
      .catch(() => {
        readFailed = true;
        if (!isCancelled()) setScripts([]);
        return [] as ScriptCard[];
      });
    const sessionsOf = (s: ScriptCard) =>
      api
        .listReadingSessions(s.id)
        .then((x) => x.sessions)
        .catch(() => {
          readFailed = true;
          return [];
        });
    // 리딩 회차는 대본별로만 받으므로 최근에 연습한 대본만 읽는다(지난 날은 기기에 쌓여 있다).
    const readingRead = scriptsRead
      .then((list) => Promise.all(recentlyPracticedScripts(list).map(sessionsOf)))
      .then((lists) => lists.flat())
      .catch(() => []);
    const entriesRead = Promise.resolve()
      .then(() => api.listMyChallengeEntries())
      .then((r) => r.entries)
      .catch(() => {
        readFailed = true;
        return [];
      });
    // 서버가 센 연습일 전체(SOMA-1003). 실패하면 위 기록과 기기 누적분만 쓴다.
    const serverDaysRead = Promise.resolve()
      .then(() => api.practiceDays())
      .then((r) => r.days)
      .catch(() => [] as string[]);
    const run = Promise.all([groupsRead, scriptsRead, readingRead, entriesRead, serverDaysRead])
      .then(async ([groupList, scriptList, readingSessions, entries, serverDays]) => {
        if (isCancelled()) return;
        const counted = countedPractices({ groups: groupList, readingSessions, entries });
        setPractices(counted);
        // 최근 연습이 하나도 안 보이면 14일보다 전에 읽은 대본도 본다 — 오래전에 끝까지 읽은 사람을 첫 사용자로 보지 않게(11/2).
        if (counted.length === 0) {
          const older = olderPracticedScripts(scriptList);
          if (older.length > 0) {
            const olderSessions = (await Promise.all(older.map(sessionsOf))).flat();
            if (isCancelled()) return;
            if (countedPractices({ readingSessions: olderSessions }).length > 0) {
              const owner = currentFirstUseOwner();
              await markFirstUseGraduated(owner);
              if (isCancelled()) return;
              if (owner) setGraduated(true);
            }
          }
        }
        setRecordsFailed(readFailed);
        const records = [...counted.map((p) => ({ created_at: p.at })), ...serverPracticeDayRecords(serverDays)];
        const owner = currentFirstUseOwner();
        return rememberPracticeDays(records, owner).then((days) => {
          if (isCancelled()) return;
          freshRecords.current = true;
          setActivityDays(days);
          // 다음에 앱을 켤 때 이 기록을 먼저 그린다(lib/home-snapshot). 받기에 실패한 갈래가 있으면 남기지 않는다.
          if (owner && !readFailed) {
            void writeHomeSnapshot({
              owner,
              groups: groupList,
              scripts: scriptList,
              practices: counted,
              activityDays: days,
              enteredChallengeIds: entries.flatMap((entry) => (entry.challenge?.id ? [entry.challenge.id] : [])),
            });
          }
        });
      })
      .then(
        () => !isCancelled() && groupsOk && !readFailed && currentFirstUseOwner() !== null,
        () => false,
      );
    recordsRead.current = run;
    return run;
  }, []);

  const focusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      focusedRef.current = true;
      void loadRecords(() => cancelled);
      return () => {
        cancelled = true;
        focusedRef.current = false;
      };
    }, [loadRecords]),
  );

  const refresh = useCallback(async () => {
    setGraduationCheck((n) => n + 1);
    await loadRecords(() => !focusedRef.current);
  }, [loadRecords]);

  // 동의·프로필 게이트가 열리는 순간 탭에 있으면 기록을 한 번 더 읽는다(11/2 폰 QA). 이미 이 계정으로 다 받았으면 다시 읽지 않는다(11/3).
  const consentAllowed = consentEntry.status === 'allowed';
  const gateOpen = consentAllowed && profile.status === 'complete';
  const gateWasOpen = useRef(gateOpen);
  useEffect(() => {
    const opened = gateOpen && !gateWasOpen.current;
    gateWasOpen.current = gateOpen;
    if (!opened) return;
    let stale = false;
    void recordsRead.current.then((ok) => {
      if (ok || stale) return;
      freshRecords.current = false;
      setActivityDays(null);
      if (focusedRef.current) void loadRecords(() => !focusedRef.current);
    });
    return () => {
      stale = true;
    };
  }, [gateOpen, loadRecords]);

  // 앱을 켤 때 지난번 기록(같은 계정, 7일 안)을 먼저 쓴다. 새 답이 먼저 왔으면 쓰지 않는다.
  const snapshotOwner = gateOpen ? (user?.id ?? null) : null;
  useEffect(() => {
    if (!snapshotOwner) return;
    let live = true;
    void readHomeSnapshot<PracticeGroup, ScriptCard, CountedPractice>(snapshotOwner).then((snap) => {
      if (!live || !snap || freshRecords.current) return;
      setGroups(snap.groups);
      setGroupsFailed(false);
      setGroupsLoaded(true);
      setScripts(snap.scripts);
      setPractices(snap.practices);
      setActivityDays(snap.activityDays);
    });
    return () => {
      live = false;
    };
  }, [snapshotOwner]);

  // 화면에 그리는 연습한 날 — 받은 기록에 이번 실행에서 막 끝낸 코칭의 날을 더한다. 기기 누적분에는 넣지 않는다(SOMA-1075).
  const shownDays = useMemo(
    () => (activityDays && sessionDays.length > 0 ? [...activityDays, ...sessionDays] : activityDays),
    [activityDays, sessionDays],
  );
  const { days } = useMemo(() => buildRecentActivity(shownDays ?? []), [shownDays]);
  const weekDays = useMemo(() => withPracticeCounts(days, practices), [days, practices]);
  const streak = useMemo(() => practiceStreak((shownDays ?? []).map((d) => d.created_at)), [shownDays]);
  const totalDays = useMemo(() => practiceDayTotal((shownDays ?? []).map((d) => d.created_at)), [shownDays]);
  const activityLoaded = shownDays !== null;

  // 방금 끝낸 연습으로 졸업했으면 저장값을 다시 읽기 전에도 안다(11/2 QA).
  const graduatedNow = graduated === true || graduatedSignal;
  const loaded = groupsLoaded && scripts !== null && activityLoaded && (graduated !== null || graduatedNow);
  const firstTime = firstTimeStateFrom({
    loaded,
    groupsFailed,
    recordsFailed,
    groups,
    scripts: scripts ?? [],
    practicedDays: shownDays?.length ?? 0,
    graduated: graduatedNow,
  });

  // 첫 사용자 상태는 한 곳에 적고 탭 화면이 읽는다(hooks/use-first-time-user).
  useEffect(() => {
    setFirstTimeState(firstTime);
  }, [firstTime]);

  // 첫 기록을 다 받으면 앱을 켤 때 붙잡아 둔 로고를 닫게 한다.
  useEffect(() => {
    if (loaded) markHomeReady();
  }, [loaded]);

  // 기록으로 첫 사용자를 벗어났으면 이 기기에 남긴다 — 서버 기록이 달라 보여도 첫 사용자로 돌아가지 않는다(11/2).
  useEffect(() => {
    if (!meId || !shouldRememberGraduation(firstTime, graduated)) return;
    void markFirstUseGraduated(meId);
    setGraduated(true);
  }, [meId, firstTime, graduated]);

  const value = useMemo<PracticeRecords>(
    () => ({
      loaded,
      firstTime,
      activityLoaded,
      recordsFailed,
      recentDays: days,
      weekDays,
      weekPracticedDays: weekDays.filter((d) => d.count > 0).length,
      streak,
      totalDays,
      practicedToday: days.some((d) => d.isToday && d.count > 0),
      practices,
      refresh,
    }),
    [loaded, firstTime, activityLoaded, recordsFailed, weekDays, streak, totalDays, days, practices, refresh],
  );

  return <PracticeRecordsContext.Provider value={value}>{children}</PracticeRecordsContext.Provider>;
}
