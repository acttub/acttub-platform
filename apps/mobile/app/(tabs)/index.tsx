import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { buildWeekActivity } from '@/lib/practice-activity';
import { practiceStreak, groupPoster, groupRowTarget, groupTitle, recentGroups } from '@/lib/practice/groups';
import type { PracticeGroup } from '@/lib/practice/types';
import { continueActionFor } from '@/lib/practice/resume';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { rememberPracticeDays } from '@/lib/practice-days';
import { countedPracticeDates } from '@/lib/practice/counted';
import { hasSeenSpotlight, hasSeenTutorial, markSpotlightSeen, markTutorialSeen } from '@/lib/guide-state';
import { currentTutorial } from '@/lib/tutorial';
import {
  localDate,
  upcomingNotices,
  type AdmissionsResponse,
} from '@/lib/admissions';
import { kstDate, urgentAuditions, type AuditionPostingList } from '@/lib/auditions';
import { dateLocale, isKorean, translate as t, translateList } from '@/lib/i18n';
import { isFirstUser, pickToday, tipIndex, type TodayItem } from '@/lib/home-today';
import type { ScriptCard, SessionProgress } from '@/lib/reading/types';
import type { ChallengeCard } from '@/lib/challenge/types';
import { loadIntoCurrent } from '@/lib/reading/store';
import { SpotlightGuide, type SpotlightStep } from '@/components/spotlight-guide';
import { finishTutorial } from '@/hooks/use-tutorial-spotlight';
import { StreakCelebrationScreen } from '@/components/streak-celebration-screen';
import { AnnouncementPoster } from '@/components/announcement-poster';
import { useAuth } from '@/lib/auth';
import { homeDeadlineSections } from '@/lib/home-sections';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { TARGET } from '@/lib/spotlight-targets';
import {
  readLastSeenStreak,
  celebrationDots,
  streakCelebrationStep,
  writeLastSeenStreak,
} from '@/lib/streak-celebration';

const PREVIEW_COUNT = 3;
const MASCOT_HOME = require('@/assets/images/mascot-home.png');
const MASCOT_FIRST = require('@/assets/images/mascot-coach.png');

/**
 * 첫 연습을 끝낸 뒤 홈에서 한 번 비추는 자리(pen 「첫 연습 끝 홈 · 안내 1/4~4/4」, SOMA-748) — 오늘 할 것 카드,
 * 그리고 대본·챌린지·프로필 탭. 첫 사용자 홈(뭐부터 해 볼까요?)에서는 띄우지 않는다.
 */
const HOME_STEPS: SpotlightStep[] = [
  { target: TARGET.homeStart, text: 'guide.spotFirstDone' },
  { target: TARGET.tabReading, text: 'guide.spotReadingTab', round: true },
  { target: TARGET.tabChallenge, text: 'guide.spotChallengeTab', round: true },
  { target: TARGET.tabProfile, text: 'guide.spotProfileTab', round: true },
];

/** 홈이 리딩 회차를 읽을 대본 — 최근 14일 안에 연습한 것만(연속일·주간 원에 쓰는 만큼). */
const READING_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
function recentlyPracticedScripts(scripts: readonly ScriptCard[], now = Date.now()): ScriptCard[] {
  return scripts.filter((s) => {
    const at = Date.parse(s.last_practiced_at ?? '');
    return Number.isFinite(at) && now - at <= READING_LOOKBACK_MS;
  });
}

function recentDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric' });
}

/**
 * A1. 홈(pen 일반 홈 BTT6at·SSeGm·gVzpd, 첫 사용자 홈 bHxn1I, SOMA-748).
 * 첫 연습 전이면 「뭐부터 해 볼까요?」 질문 셋, 그 뒤로는 인사 + 오늘 할 것 카드 하나 + 하던 거 한 줄 +
 * 최근 연습·마감 임박(practice.library·app.audition) + 오늘의 연기 팁이다.
 * 디자인의 「업데이트 소식」 띠와 일정 D-day 줄은 서버 기능이 없어 그리지 않는다.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { user, consentEntry, profile } = useAuth();
  const unread = useUnreadNotifications();
  // 재동의 팝업이 떠 있는 동안 홈의 첫 안내들을 띄우지 않는다. 둘 다 홈 위에 덮여 어느 쪽이 위에 올지 정해지지 않는다.
  // 팝업(Modal)이 닫히는 동안 다른 Modal을 띄우면 iOS가 띄우지 못해, 닫힘이 끝난 뒤에 연다
  // (iOS 시뮬레이터에서 400ms는 시트가 안 떴고 700ms는 떴다. 여유를 둔 값이다).
  const consentAllowed = consentEntry.status === 'allowed';
  const [overlaysReady, setOverlaysReady] = useState(consentAllowed);
  useEffect(() => {
    if (!consentAllowed) {
      setOverlaysReady(false);
      return;
    }
    const timer = setTimeout(() => setOverlaysReady(true), 800);
    return () => clearTimeout(timer);
  }, [consentAllowed]);
  const [groups, setGroups] = useState<PracticeGroup[]>([]);
  // 묶음을 한 번이라도 받아 봤는지(실패도 받은 셈) — 받기 전엔 첫 사용자 화면을 함부로 띄우지 않는다.
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupsFailed, setGroupsFailed] = useState(false);
  const [scripts, setScripts] = useState<ScriptCard[] | null>(null);
  const [readingProgress, setReadingProgress] = useState<{ scriptId: string; progress: SessionProgress } | null>(null);
  const [featured, setFeatured] = useState<ChallengeCard | null>(null);
  // 연속일·주간 원용 날짜 — 서버 기록 ∪ 기기에 누적된 연습일(지워도 남는다).
  // null 이면 기록을 아직 한 번도 못 받은 것이다 — 그때의 연속일(0)로 축하를 판단하면 안 된다.
  const [activityDays, setActivityDays] = useState<{ created_at: string }[] | null>(null);
  const [admissions, setAdmissions] = useState<AdmissionsResponse | null>(null);
  const [auditions, setAuditions] = useState<AuditionPostingList | null>(null);
  const [celebrateStreak, setCelebrateStreak] = useState<number | null>(null);
  // 처음 한 번만 가이드 — 누를 자리를 비춰 준다. 설정의 "가이드 다시 보기"로 되살릴 수 있다.
  const [guideOpen, setGuideOpen] = useState(false);
  const [introChecked, setIntroChecked] = useState(false);
  const [onboardingJustFinished, setOnboardingJustFinished] = useState(false);
  const startTarget = useSpotlightTarget(TARGET.homeStart);

  const openHomeGuideIfNew = useCallback(() => {
    void hasSeenSpotlight('home').then((seen) => {
      if (!seen) setGuideOpen(true);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      // 올 때마다 본 적 있는지 묻는다(기기에서 읽는 값이라 싸다). 한 번만 묻고 말면,
      // 설정에서 되살린 뒤 앱을 껐다 켜야 보인다 — 실기기에서 그렇게 걸렸다.
      // 튜토리얼 중에 홈으로 돌아왔다면 루프를 벗어난 것이다 — 거기서 끝낸다.
      if (currentTutorial()) finishTutorial('left');
      void hasSeenTutorial().then((seen) => {
        setIntroChecked(true);
        // 예전 「연습 한 바퀴」 시트는 새 디자인에서 첫 사용자 홈(뭐부터 해 볼까요?)이 대신한다(SOMA-748).
        if (!seen) {
          void markTutorialSeen();
          setOnboardingJustFinished(true);
        }
        openHomeGuideIfNew();
      });
      let cancelled = false;
      const groupsRead = api
        .listPracticeGroups('all')
        .then((r) => {
          if (cancelled) return r.groups;
          setGroups(r.groups);
          setGroupsFailed(false);
          setGroupsLoaded(true);
          return r.groups;
        })
        .catch(() => {
          if (!cancelled) {
            setGroups([]);
            setGroupsFailed(true);
            setGroupsLoaded(true);
          }
          return [] as PracticeGroup[];
        });
      // 오늘 할 것의 리딩 후보 — 이어 읽을 대본. 실패하면 리딩 후보만 빠진다.
      const scriptsRead = Promise.resolve()
        .then(() => api.listReadingScripts())
        .then((r) => {
          if (!cancelled) setScripts(r.scripts);
          return r.scripts;
        })
        .catch(() => {
          if (!cancelled) setScripts([]);
          return [] as ScriptCard[];
        });
      // 연속일·주간 원·「첫 연습 끝!」은 「연습 1회」 기준 하나로 센다(SOMA-773) — 노트가 생긴 코칭 회차, 끝까지 읽은
      // 리딩 회차, 올린 참여작. 리딩 회차는 대본별로만 받으므로 최근에 연습한 대본만 읽는다(지난 날은 기기에 쌓여 있다).
      const readingRead = scriptsRead
        .then((list) => Promise.all(recentlyPracticedScripts(list).map((s) => api.listReadingSessions(s.id).then((x) => x.sessions).catch(() => []))))
        .then((lists) => lists.flat())
        .catch(() => []);
      const entriesRead = Promise.resolve()
        .then(() => api.listMyChallengeEntries())
        .then((r) => r.entries)
        .catch(() => []);
      void Promise.all([groupsRead, readingRead, entriesRead]).then(([groupList, readingSessions, entries]) =>
        // 연습한 날은 기기에도 쌓아 둔다 — 기록을 숨겨도 "그 날 연습했다"는 사실은 남는다.
        rememberPracticeDays(countedPracticeDates({ groups: groupList, readingSessions, entries })).then((days) => {
          if (!cancelled) setActivityDays(days);
        }),
      );
      return () => {
        cancelled = true;
      };
    }, [router, openHomeGuideIfNew]),
  );

  useEffect(() => {
    // 입시는 로그인과 무관하고 배포 때만 바뀐다 — 포커스마다 다시 읽지 않는다.
    // 한국어를 안 쓰는 사람에겐 보여줄 자리가 없으니 받아오지도 않는다 (SOMA-544).
    if (!isKorean()) return;
    let cancelled = false;
    api
      .admissions()
      .then((data) => {
        if (!cancelled) setAdmissions(data);
      })
      .catch(() => {
        if (!cancelled) setAdmissions(null);
      });
    // 오디션 공고도 한국 공고뿐이고(app.audition) 하루 두 번 바뀐다 — 입시와 같이 홈을 열 때 한 번만 읽는다.
    api
      .auditions()
      .then((data) => {
        if (!cancelled) setAuditions(data);
      })
      .catch(() => {
        if (!cancelled) setAuditions(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 연기 입시는 한국 대학 일정이라 한국어로 쓰는 사람에게만 쓸모가 있다 (SOMA-544).
  const deadlines = useMemo(
    () => (admissions && isKorean() ? upcomingNotices(admissions, localDate(), 2) : []),
    [admissions],
  );
  // 입시생(만 19세 이하)은 입시만, 만 20세 이상 입시생은 둘 다, 나머지는 오디션만 본다(SOMA-654).
  const sections = homeDeadlineSections(profile.me?.profile, kstDate());
  // 마감일이 있는 공고 중 가까운 둘. 비면(기능 꺼짐·공고 없음) 칸째 숨긴다.
  const auditionDeadlines = useMemo(
    () => (auditions && isKorean() ? urgentAuditions(auditions.items, kstDate(), 2) : []),
    [auditions],
  );

  const { days } = useMemo(() => buildWeekActivity(activityDays ?? []), [activityDays]);
  // 연속 연습 일수는 회차 시작 날짜를 한국 시간으로 센다(practice.library).
  const streak = useMemo(() => practiceStreak((activityDays ?? []).map((d) => d.created_at)), [activityDays]);
  const activityLoaded = activityDays !== null;
  // 「첫 연습 끝!」 안내는 연습 1회(노트 생긴 코칭·끝낸 리딩·올린 참여작)를 한 뒤에만 띄운다(SOMA-773).
  const practiced = (activityDays?.length ?? 0) > 0;

  // 연속일이 오늘 늘었으면(마지막으로 본 값보다 크면) 딱 한 번 축하한다 (SOMA-479).
  // 기록을 받기 전엔 판단하지 않는다 — 그 판정은 streakCelebrationStep 이 한다(SOMA-494).
  useEffect(() => {
    let cancelled = false;
    void readLastSeenStreak().then((lastSeen) => {
      if (cancelled) return;
      const step = streakCelebrationStep({ loaded: activityLoaded, lastSeen, current: streak });
      if (step.celebrate) setCelebrateStreak(streak);
      if (step.remember !== null) void writeLastSeenStreak(step.remember);
    });
    return () => {
      cancelled = true;
    };
  }, [activityLoaded, streak]);

  // 홈의 최근 연습은 숨기지 않은 묶음 3개다.
  const recent = useMemo(() => recentGroups(groups, PREVIEW_COUNT), [groups]);

  const loaded = groupsLoaded && scripts !== null && activityLoaded;
  // 묶음을 못 받았으면 첫 사용자로 보지 않는다 — 연습한 사람에게 첫 화면을 보이는 쪽이 더 이상하다.
  const firstUser =
    loaded && !groupsFailed && isFirstUser({ groups, scripts: scripts ?? [], practicedDays: activityDays?.length ?? 0 });

  const today = useMemo(
    () => pickToday({ groups, scripts: scripts ?? [], challenge: featured, now: new Date() }),
    [groups, scripts, featured],
  );

  // 코칭·리딩 할 일이 없을 때만 오늘의 챌린지를 받아 온다.
  const needsChallenge = loaded && !firstUser && today.main.kind === 'start' && featured === null;
  useEffect(() => {
    if (!needsChallenge) return;
    let cancelled = false;
    api
      .listChallenges({ tab: 'popular' })
      .then((r) => {
        if (!cancelled && r.featured) setFeatured(r.featured);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [needsChallenge]);

  // 리딩 카드면 그 대본의 진행 중 회차에서 몇 줄까지 읽었는지 받아 온다.
  const readingScriptId = today.main.kind === 'reading' ? today.main.script.id : null;
  useEffect(() => {
    if (!readingScriptId) return;
    let cancelled = false;
    api
      .listReadingSessions(readingScriptId)
      .then(({ sessions }) => {
        const open = sessions.find((s) => s.status === 'in_progress' && s.progress);
        if (!cancelled) setReadingProgress(open?.progress ? { scriptId: readingScriptId, progress: open.progress } : null);
      })
      .catch(() => {
        if (!cancelled) setReadingProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [readingScriptId]);

  const tips = translateList('home.tips');
  const tip = tips.length > 0 ? tips[tipIndex(new Date(), tips.length)] : null;

  const openCoaching = (group: PracticeGroup) => {
    const action = continueActionFor(group);
    if (action.kind === 'resume') {
      router.push({ pathname: '/analyzing', params: { practiceId: action.practiceId } });
      return;
    }
    const last = group.practices[group.practices.length - 1];
    setContinueOrigin({ kind: 'group', rootId: group.root_id, practiceId: last?.id ?? group.root_id });
    router.push('/upload');
  };

  const openReading = async (script: ScriptCard) => {
    const opened = await loadIntoCurrent(script.id);
    if (opened) router.push('/reading/detail');
    else router.push('/reading');
  };

  const openItem = (item: TodayItem) => {
    if (item.kind === 'coaching') openCoaching(item.group);
    else if (item.kind === 'reading') void openReading(item.script);
    else if (item.kind === 'challenge') router.push({ pathname: '/challenge-detail', params: { id: item.challenge.id } });
    else router.push('/coaching');
  };

  const bell = (
    <Pressable
      onPress={() => router.push('/notifications')}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={unread.count > 0 ? t('home.bellUnreadA11y') : t('home.bellA11y')}
      style={styles.bell}>
      <Feather name="bell" size={22} color={palette.text} />
      {unread.count > 0 && <View style={styles.bellDot} />}
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {celebrateStreak !== null && overlaysReady && (
        <StreakCelebrationScreen
          streak={celebrateStreak}
          dots={celebrationDots(days)}
          onDone={() => setCelebrateStreak(null)}
        />
      )}
      {!loaded ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : firstUser ? (
        // 첫 사용자 홈(bHxn1I) — 셋 중 하나를 고른다. 첫 줄이 첫 가이드가 비추는 자리다.
        <ScrollView contentContainerStyle={styles.firstContainer}>
          <View style={styles.firstHead}>
            <Image source={MASCOT_FIRST} style={styles.firstMascot} contentFit="contain" accessibilityIgnoresInvertColors />
            <Text style={styles.firstQuestion}>{t('home.firstQuestion')}</Text>
          </View>
          <View style={styles.firstChoices}>
            <Pressable
              ref={startTarget.ref}
              onLayout={startTarget.onLayout}
              onPress={() => router.push('/coaching')}
              accessibilityRole="button"
              accessibilityLabel={t('home.firstCoaching')}
              style={({ pressed }) => [styles.choice, styles.choiceMain, pressed && styles.pressed]}>
              <Text style={[styles.choiceText, styles.choiceTextMain]}>{t('home.firstCoaching')}</Text>
              <Feather name="chevron-right" size={18} color={palette.blueDeep} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/reading')}
              accessibilityRole="button"
              accessibilityLabel={t('home.firstReading')}
              style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
              <Text style={styles.choiceText}>{t('home.firstReading')}</Text>
              <Feather name="chevron-right" size={18} color={palette.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/challenges')}
              accessibilityRole="button"
              accessibilityLabel={t('home.firstChallenge')}
              style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
              <Text style={styles.choiceText}>{t('home.firstChallenge')}</Text>
              <Feather name="chevron-right" size={18} color={palette.textMuted} />
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          {/* 머리 — 마스코트 + 인사 + 알림 종. 일정 D-day 줄은 일정 기능(서버)이 생기면 붙인다. */}
          <View style={styles.head}>
            <Image source={MASCOT_HOME} style={styles.headMascot} contentFit="contain" accessibilityIgnoresInvertColors />
            <Text style={styles.greeting}>{t('home.greeting')}</Text>
            {bell}
          </View>

          {/* 오늘 할 것 — 카드 하나. 첫 가이드가 비추는 자리다. */}
          <View ref={startTarget.ref} onLayout={startTarget.onLayout} collapsable={false} style={styles.todayCard}>
            <TodayCardBody
              item={today.main}
              progress={
                today.main.kind === 'reading' && readingProgress?.scriptId === today.main.script.id
                  ? readingProgress.progress
                  : null
              }
              onPress={() => openItem(today.main)}
            />
          </View>

          {/* 하던 거 한 줄 — 오늘 할 것으로 고르지 않은 나머지 하나. */}
          {today.also && (
            <Pressable
              onPress={() => openItem(today.also as TodayItem)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.alsoRow, pressed && styles.pressed]}>
              <View style={[styles.alsoDot, today.also.kind === 'reading' ? styles.dotGreen : styles.dotBlue]} />
              <Text style={styles.alsoText} numberOfLines={1}>
                {alsoLabel(today.also)}
              </Text>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </Pressable>
          )}

          {/* 최근 연습 — 숨기지 않은 묶음 3개(practice.library). 대본 리딩 기록은 섞지 않는다. */}
          {recent.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('home.recentTitle')}</Text>
                <Pressable onPress={() => router.push('/history')} hitSlop={8}>
                  <Text style={styles.sectionLink}>{t('common.viewAll')}</Text>
                </Pressable>
              </View>
              {recent.map((r) => {
                const poster = groupPoster(r);
                return (
                  <Pressable
                    key={r.root_id}
                    style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
                    // 대화 중인 묶음은 그 대화로 바로 돌아간다(SOMA-672).
                    onPress={() => router.push(groupRowTarget(r))}>
                    <View style={styles.thumb}>
                      {/* 첫 장면 사진 — 서버가 만들기 전이면 원래 아이콘 그대로다(SOMA-671). */}
                      {poster ? (
                        <Image source={{ uri: poster.uri, cacheKey: poster.cacheKey }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                      ) : (
                        <Feather name="film" size={16} color={palette.blue} />
                      )}
                    </View>
                    <View style={styles.flex}>
                      <View style={styles.listTitleRow}>
                        <Text style={[styles.listTitle, styles.shrink]} numberOfLines={1}>{groupTitle(r)}</Text>
                        {r.in_progress_practice_id && (
                          <View style={styles.talkingBadge}>
                            <Text style={styles.talkingBadgeText}>{t('history.inConversation')}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.listMeta}>{recentDate(r.last_practiced_at ?? '')}</Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={palette.checkOff} />
                  </Pressable>
                );
              })}
            </>
          )}

          {/* 입시 마감 — 실기 일정은 놓치면 1년을 기다린다. 임박한 둘만 띄운다. */}
          {sections.admissions && deadlines.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('home.admissionsTitle')}</Text>
                <Pressable onPress={() => router.push('/admissions')} hitSlop={8}>
                  <Text style={styles.sectionLink}>{t('common.viewAll')}</Text>
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('home.admissionsA11y')}
                onPress={() => router.push('/admissions')}>
                {deadlines.map(({ university, notice, remaining }) => (
                  <View key={notice.id} style={styles.listRow}>
                    <Text style={styles.dday}>D-{remaining.days === 0 ? 'DAY' : remaining.days}</Text>
                    <View style={styles.flex}>
                      <Text style={styles.listTitle} numberOfLines={1}>{university.name}</Text>
                      <Text style={styles.listMeta} numberOfLines={1}>
                        {[notice.department, remaining.label].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </View>
                ))}
              </Pressable>
            </>
          )}

          {/* 오디션 마감 임박 — 입시와 같은 모양. 누르면 모아보기로 간다(app.audition). */}
          {sections.auditions && auditionDeadlines.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('home.auditionsTitle')}</Text>
                <Pressable onPress={() => router.push('/auditions')} hitSlop={8}>
                  <Text style={styles.sectionLink}>{t('common.viewAll')}</Text>
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('home.auditionsA11y')}
                onPress={() => router.push('/auditions')}>
                {auditionDeadlines.map(({ posting, days }) => (
                  <View key={posting.id} style={styles.listRow}>
                    <Text style={styles.dday}>D-{days === 0 ? 'DAY' : days}</Text>
                    <View style={styles.flex}>
                      <Text style={styles.listTitle} numberOfLines={1}>{posting.title}</Text>
                      <Text style={styles.listMeta} numberOfLines={1}>{posting.source_name}</Text>
                    </View>
                  </View>
                ))}
              </Pressable>
            </>
          )}

          {/* 오늘의 연기 팁 — 하루 동안 같은 한 줄. */}
          {tip && (
            <View style={styles.tip} accessibilityLabel={`${t('home.tipsTitle')}: ${tip}`}>
              <Ionicons name="bulb-outline" size={18} color={palette.hintIcon} />
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          )}
        </ScrollView>
      )}
      <SpotlightGuide
        visible={guideOpen && overlaysReady && loaded && !firstUser && practiced}
        topic="home"
        steps={HOME_STEPS}
        onDone={() => {
          setGuideOpen(false);
          void markSpotlightSeen('home');
        }}
      />
      <AnnouncementPoster
        loggedIn={!!user}
        blocked={!overlaysReady || !introChecked || guideOpen || celebrateStreak !== null}
        onboardingJustFinished={onboardingJustFinished}
      />
    </SafeAreaView>
  );
}

function alsoLabel(item: TodayItem): string {
  if (item.kind === 'coaching') return t('home.alsoCoaching', { title: item.noteTitle ?? groupTitle(item.group) });
  if (item.kind === 'reading') return t('home.alsoReading', { title: item.script.title });
  return '';
}

/** 오늘 할 것 카드 속 — 종류마다 머리 한 줄(색)·제목·보조·버튼. */
function TodayCardBody({ item, progress, onPress }: { item: TodayItem; progress: SessionProgress | null; onPress: () => void }) {
  let eyebrow: string;
  let eyebrowStyle = styles.eyebrowBlue;
  let title: string;
  let sub: string | null = null;
  let cta: string;
  let bar: number | null = null;

  if (item.kind === 'coaching') {
    const action = continueActionFor(item.group);
    eyebrow = t('home.todayCoachingEyebrow');
    title = item.noteTitle ? `「${item.noteTitle}」` : groupTitle(item.group);
    sub = t('home.todayCoachingSub', { title: groupTitle(item.group), n: item.group.ordinal_count + 1 });
    cta = action.kind === 'resume' ? t('history.resumeConversation') : t('home.todayCoachingCta');
  } else if (item.kind === 'reading') {
    eyebrow = t('home.todayReadingEyebrow');
    eyebrowStyle = styles.eyebrowGreen;
    title = item.script.title;
    if (progress && progress.total > 0) {
      bar = Math.min(1, Math.max(0, progress.done / progress.total));
      sub = t('home.todayReadingProgress', { total: progress.total, done: progress.done });
      cta = progress.done < progress.total ? t('home.todayReadingCta', { line: progress.done + 1 }) : t('home.todayReadingCtaPlain');
    } else {
      cta = t('home.todayReadingCtaPlain');
    }
  } else if (item.kind === 'challenge') {
    eyebrow = item.daysLeft === 0 ? t('home.todayChallengeEyebrowToday') : t('home.todayChallengeEyebrow', { days: item.daysLeft });
    eyebrowStyle = styles.eyebrowOrange;
    title = `“${item.challenge.line}”`;
    sub = item.challenge.work;
    cta = t('home.todayChallengeCta');
  } else {
    eyebrow = t('home.todayStartEyebrow');
    title = t('home.todayStartTitle');
    sub = t('home.todayStartSub');
    cta = t('home.todayStartCta');
  }

  return (
    <>
      <Text style={[styles.eyebrow, eyebrowStyle]}>{eyebrow}</Text>
      <Text style={styles.todayTitle} numberOfLines={3}>{title}</Text>
      {bar !== null && (
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${Math.round(bar * 100)}%` }]} />
        </View>
      )}
      {sub ? <Text style={styles.todaySub} numberOfLines={2}>{sub}</Text> : null}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={cta}
        style={({ pressed }) => [styles.todayCta, pressed && styles.pressed]}>
        <Text style={styles.todayCtaText}>{cta}</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // 아래 탭 바가 화면 위에 떠 있어 그만큼 바닥을 비운다.
  container: { paddingHorizontal: 20, paddingTop: 30, paddingBottom: 140 },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.85 },

  // 첫 사용자 홈(bHxn1I)
  firstContainer: { paddingTop: 80, paddingHorizontal: 24, paddingBottom: 140, gap: 16 },
  firstHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  firstMascot: { width: 52, height: 58 },
  firstQuestion: { flex: 1, fontSize: 28, fontWeight: '800', lineHeight: 38, color: palette.text },
  firstChoices: { gap: 12, paddingTop: 24 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: palette.bgSoft,
  },
  choiceMain: { backgroundColor: palette.blueSoft },
  choiceText: { flex: 1, fontSize: 16, fontWeight: '700', lineHeight: 24, color: palette.text },
  choiceTextMain: { fontWeight: '800', color: palette.blueDeep },

  // 머리
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headMascot: { width: 48, height: 54 },
  greeting: { flex: 1, fontSize: 20, fontWeight: '800', lineHeight: 27, color: palette.text },
  bell: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  bellDot: {
    position: 'absolute',
    top: 4,
    right: 5,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.flame,
    borderWidth: 1.5,
    borderColor: palette.bg,
  },

  // 오늘 할 것
  todayCard: { marginTop: 24, backgroundColor: palette.bgSoft, borderRadius: 22, padding: 20, gap: 10 },
  eyebrow: { fontSize: 12, fontWeight: '800', lineHeight: 18 },
  eyebrowBlue: { color: palette.blue },
  eyebrowGreen: { color: palette.green },
  eyebrowOrange: { color: palette.flameDeep },
  todayTitle: { fontSize: 18, fontWeight: '800', lineHeight: 24, color: palette.text },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: palette.bg, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: palette.green },
  todaySub: { fontSize: 13, fontWeight: '600', lineHeight: 20, color: palette.textDim },
  todayCta: {
    marginTop: 4,
    height: 50,
    borderRadius: 25,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCtaText: { fontSize: 16, fontWeight: '800', color: palette.onAccent },

  // 하던 거 한 줄
  alsoRow: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 4 },
  alsoDot: { width: 8, height: 8, borderRadius: 4 },
  dotBlue: { backgroundColor: palette.blue },
  dotGreen: { backgroundColor: palette.green },
  alsoText: { flex: 1, fontSize: 15, fontWeight: '700', lineHeight: 22, color: palette.textDim },

  // 최근 연습·마감 임박 — 카드 없이 줄만
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 28,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: palette.textFaint },
  sectionLink: { fontSize: 13, fontWeight: '700', color: palette.blue },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4 },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  listTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  listTitle: { fontSize: 15, fontWeight: '700', lineHeight: 22, color: palette.text },
  listMeta: { marginTop: 2, fontSize: 12, fontWeight: '500', lineHeight: 17, color: palette.textFaint },
  talkingBadge: { borderRadius: 9999, backgroundColor: palette.blueSoft, paddingVertical: 2, paddingHorizontal: 8 },
  talkingBadgeText: { fontSize: 11, fontWeight: '800', color: palette.blueDeep },
  dday: { minWidth: 52, fontSize: 13, fontWeight: '800', color: palette.flameDeep },

  // 오늘의 연기 팁
  tip: { marginTop: 32, flexDirection: 'row', gap: 10, paddingHorizontal: 4 },
  tipText: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 21, color: palette.textMuted },
});
