import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { SpotlightGuide, type SpotlightStep } from '@/components/spotlight-guide';
import { Button } from '@/components/ui/buttons';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError } from '@/components/ui/inline-error';
import { BlueSwitch } from '@/components/ui/list-rows';
import { SkeletonRows } from '@/components/ui/skeleton';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useCloudVoice } from '@/hooks/use-cloud-voice';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { hasSeenReadingTutorial, hasSeenSpotlight, markReadingTutorialSeen, markSpotlightSeen } from '@/lib/guide-state';
import { skipsReadingTabGuide } from '@/lib/returning-account';
import { finishTutorial } from '@/hooks/use-tutorial-spotlight';
import { currentTutorial } from '@/lib/tutorial';
import { TARGET } from '@/lib/spotlight-targets';
import { useAppDialog } from '@/components/app-dialog';
import { TitleEditDialog } from '@/components/title-edit-dialog';
import { NavBackButton, NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { CHIP_TONE, myCharactersLabel, statusChip } from '@/lib/reading/script-cards';
import { resumeCandidate, resumeSessionOf } from '@/lib/reading/redesign-748';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { deleteScript, fetchSession, listScripts, listSessions, loadIntoCurrent, setCurrentSession } from '@/lib/reading/store';
import type { ScriptCard, ScriptListResponse, SessionCard } from '@/lib/reading/types';
import { isKorean, translate as t } from '@/lib/i18n';
import type { GestureResponderEvent } from 'react-native';

import { pt } from '@/components/ui/anchored-menu';

/**
 * 내 대본 목록(R00, reading.script). 서버 목록이 정본이다 — 최근 고친 순, 머리 "전체 N개 · 연습 중 M개",
 * 카드마다 제목·내 배역·대사 수·녹음 수·마지막 활동·상태 칩(연습 중·연습 완료, 배역을 안 골랐으면 없음). 검색은 서버가
 * 제목과 배역 이름만 찾는다. "분석 완료" 칩은 리딩에 분석이 없어 없다.
 */
const SEARCH_DEBOUNCE_MS = 300;

type EntryKey = 'upload' | 'sample' | 'make';
const ENTRY_CHOICES: { key: EntryKey; title: string; sub: string; primary?: boolean }[] = [
  { key: 'upload', title: 'reading.entryUpload', sub: 'reading.entryUploadSub', primary: true },
  { key: 'sample', title: 'reading.entrySample', sub: 'reading.entrySampleSub' },
  { key: 'make', title: 'reading.entryMake', sub: 'reading.entryMakeSub' },
];
const ENTRY_ART: Partial<Record<EntryKey, number>> = {
  upload: require('@/assets/images/reading/upload-folder-3d.png'),
  sample: require('@/assets/images/reading/sample-script-3d.png'),
};
const HERO_ACTY = require('@/assets/images/reading/hero-acty-stack.png');

/** 대본 탭에서 처음 한 번 비추는 자리 — 대본을 들이는 버튼 하나뿐이다 (SOMA-550). */
const READING_STEPS: SpotlightStep[] = [{ target: TARGET.readingNew, text: 'guide.spotReadingNew' }];

export default function ReadingList() {
  const tabBarSpace = useTabBarSpace();
  const router = useRouter();
  const firstTime = useFirstTimeUser();
  const insets = useSafeAreaInsets();
  const cloudVoice = useCloudVoice();
  const refreshVoice = cloudVoice.refresh;
  const voiceFreeUntil = cloudVoice.status?.free_until
    ? new Date(cloudVoice.status.free_until).toLocaleDateString(isKorean() ? 'ko-KR' : 'en-US', { month: 'long', day: 'numeric' })
    : '';
  const { confirm, sheet, alert, dialog } = useAppDialog();
  const [list, setList] = useState<ScriptListResponse | null>(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScriptCard | null>(null);
  /** 「이전에 하던 데부터」 카드 — 연습 중 대본의 진행 중 회차(pen 「새 · 내 대본」). */
  const [resume, setResume] = useState<{ script: ScriptCard; session: SessionCard } | null>(null);
  const [resuming, setResuming] = useState(false);
  const generation = useRef(0);
  // 대본 탭에서 처음 한 번만 — 홈 가이드와 따로 센다 (SOMA-550).
  const [guideOpen, setGuideOpen] = useState(false);
  // 안내는 앱 맨 바깥에 그려져 다른 화면 위에도 덮인다 — 이 탭이 보일 때만 연다.
  const guideFocused = useRef(false);
  const newTarget = useSpotlightTarget(TARGET.readingNew);

  // 첫 사용자는 고르기 화면(「대사를 같이 맞춰 읽어 볼까요?」)이 안내를 대신한다 — 예전 「대본을 넣어 보세요」를 겹쳐 띄우지 않는다.
  const firstTimeRef = useRef(firstTime);
  firstTimeRef.current = firstTime;
  const openReadingGuideIfNew = useCallback(() => {
    void hasSeenSpotlight('reading').then((seen) => {
      if (!seen && guideFocused.current && !firstTimeRef.current) setGuideOpen(true);
    });
  }, []);

  // 대본을 이미 올린 계정(앱을 다시 깐 기존 사용자)에게는 「대본을 넣어 보세요」를 띄우지 않고 본 것으로 남긴다(10/26).
  const hasScripts = !!list && skipsReadingTabGuide(Math.max(list.total_count, list.scripts.length));
  useEffect(() => {
    if (!guideOpen || !hasScripts) return;
    setGuideOpen(false);
    void markSpotlightSeen('reading');
  }, [guideOpen, hasScripts]);

  const load = useCallback(async (keyword: string) => {
    const mine = ++generation.current;
    setError(null);
    try {
      const next = await listScripts(keyword);
      if (mine === generation.current) setList(next);
      // 검색 중이 아닐 때만 이어 읽을 회차를 찾는다. 못 찾으면 카드 없이 목록만 보인다.
      const candidate = keyword.trim() ? null : resumeCandidate(next.scripts);
      if (!candidate) {
        if (!keyword.trim() && mine === generation.current) setResume(null);
      } else {
        const session = resumeSessionOf(await listSessions(candidate.id).catch(() => []));
        if (mine === generation.current) setResume(session ? { script: candidate, session } : null);
      }
    } catch (e) {
      if (mine === generation.current) setError(scriptErrorMessage(e));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      guideFocused.current = true;
      void load(q);
      // 설정의 동의 목록에서 고품질 목소리 동의를 바꿨을 수 있다 — 스위치를 다시 맞춘다.
      void refreshVoice().catch(() => undefined);
      // 올 때마다 묻는다 — 설정에서 되살린 뒤 앱을 다시 켜야 보이면 아무도 못 본다.
      // 대본 리딩 튜토리얼 중에 목록으로 돌아왔다면 루프를 벗어난 것이다 — 거기서 끝낸다.
      if (currentTutorial()?.track === 'reading') finishTutorial('left');
      void hasSeenReadingTutorial().then((seen) => {
        // 예전 「대본 리딩 한 바퀴」 시트는 새 디자인에서 대본 탭 입구가 대신한다(SOMA-748).
        if (!seen) void markReadingTutorialSeen();
        openReadingGuideIfNew();
      });
      return () => {
        generation.current += 1;
        // 떠나면 닫는다 — 설정에 다녀오면 다시 묻고 연다.
        guideFocused.current = false;
        setGuideOpen(false);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  // 검색어는 잠깐 기다렸다가 서버에 묻는다(제목·배역 이름만). 처음 그릴 때는 포커스 로드가 맡는다.
  const searchedOnce = useRef(false);
  useEffect(() => {
    if (!searchedOnce.current) {
      searchedOnce.current = true;
      return;
    }
    const timer = setTimeout(() => void load(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, load]);

  const open = async (s: ScriptCard) => {
    const opened = await loadIntoCurrent(s.id);
    if (!opened) {
      void load(q);
      return;
    }
    router.push('/reading/detail');
  };
  const remove = async (s: ScriptCard) => {
    const ok = await confirm({
      title: t('reading.deleteTitle'),
      message: t('reading.deleteBody'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteScript(s.id);
    } catch (e) {
      void alert({ title: t('reading.deleteAction'), message: scriptErrorMessage(e) });
    }
    void load(q);
  };
  const more = (s: ScriptCard, e?: GestureResponderEvent) =>
    void sheet({
      anchor: pt(e),
      title: s.title,
      actions: [
        { label: t('reading.editAction'), icon: 'edit-2', onPress: () => setEditing(s) },
        { label: t('reading.deleteAction'), icon: 'trash-2', destructive: true, onPress: () => void remove(s) },
      ],
    });

  const scripts = list?.scripts ?? [];
  const searching = q.trim().length > 0;
  const empty = !!list && scripts.length === 0 && !searching;

  const goEntry = (choice: EntryKey) => {
    if (choice === 'upload') router.push('/reading/new');
    else if (choice === 'sample') router.push('/reading/sample');
    else if (choice === 'make') router.push({ pathname: '/script-cocreate', params: { mode: 'reading' } });
  };

  const continueReading = async () => {
    if (!resume || resuming) return;
    setResuming(true);
    try {
      const opened = await loadIntoCurrent(resume.script.id);
      const detail = opened ? await fetchSession(resume.session.id) : null;
      if (!detail) {
        void load(q);
        return;
      }
      setCurrentSession(detail);
      router.push('/reading/play');
    } finally {
      setResuming(false);
    }
  };

  const voiceBar = (
    cloudVoice.status?.available ? (
      <View style={styles.voiceBar}>
        <MaterialCommunityIcons name="waveform" size={18} color={palette.blue} />
        <Text style={styles.voiceText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
          {t('cloudVoice.bannerLabel')}
        </Text>
        {!!voiceFreeUntil && <Text style={styles.voiceBadgeText}>{t('cloudVoice.bannerFree', { date: voiceFreeUntil })}</Text>}
        <BlueSwitch
          value={cloudVoice.enabled && cloudVoice.status.consent === 'granted'}
          onValueChange={(value) => void (value ? cloudVoice.enable('settings') : cloudVoice.disable())}
          disabled={cloudVoice.busy}
          accessibilityLabel={t('cloudVoice.bannerLabel')}
        />
      </View>
    ) : null
  );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top, paddingBottom: tabBarSpace + 20 }]}
      keyboardShouldPersistTaps="handled">
      {empty && (
        <View style={[styles.emptyBg, { height: 300 + insets.top }]} pointerEvents="none" />
      )}
      {/* NavHeader/Large — 대본이 없으면 「대본」, 있으면 「내 대본」. 첫 사용자는 탭바가 숨으므로 홈(뭐부터 해 볼까요?)으로
          돌아갈 꺾쇠를 단다 — 탭바가 보이면 두지 않는다. */}
      <View style={styles.headWrap}>
        <NavHeader
          large
          title={empty ? '' : t('reading.listTitle')}
          left={firstTime ? <NavBackButton onPress={() => router.navigate('/')} phLabel="reading_back_home" /> : undefined}
          right={
            <View style={styles.headRight}>
              {/* 탭바가 숨어 프로필 탭의 설정으로 못 가므로 로그아웃·탈퇴 길을 남긴다(SOMA-781). */}
              {firstTime && (
                <NavIconButton icon="settings" size={24} label={t('settings.title')} phLabel="reading_first_settings" onPress={() => router.push('/settings')} />
              )}
              {!empty && (
                <View ref={newTarget.ref} onLayout={newTarget.onLayout}>
                  <Button
                    size="md"
                    label={t('reading.titleNew')}
                    icon={<Feather name="plus" size={16} color={palette.onAccent} />}
                    phLabel="reading_new"
                    onPress={() => router.push('/reading/new')}
                  />
                </View>
              )}
            </View>
          }
        />
      </View>

      {/* 고품질 목소리 띠 — 대본이 있어도 머리 아래에 둔다(10/25 사용자 결정, 기본 켜짐). */}
      {!empty && voiceBar}

      {error && <InlineError message={t('reading.listLoadFail')} onRetry={() => void load(q)} />}

      {empty ? (
        // pen R1.13 — 큰 「리딩」 제목과 책 위 액티, 고품질 목소리 알약, 그라데이션 입구 카드 셋(누르면 바로 들어감).
        <View style={styles.entry}>
          <View style={styles.hero}>
            <View style={styles.heroText}>
              <Text style={styles.heroTitle} accessibilityRole="header">{t('reading.tabTitle')}</Text>
              <Text style={styles.heroSub}>{t('reading.entryHeroSub')}</Text>
            </View>
            <Image source={HERO_ACTY} style={styles.heroActy} resizeMode="stretch" accessibilityElementsHidden />
          </View>
          {voiceBar}
          <View style={styles.entryCards}>
            {ENTRY_CHOICES.map((c) => (
              <Pressable
                key={c.key}
                ref={c.key === 'upload' ? newTarget.ref : undefined}
                onLayout={c.key === 'upload' ? newTarget.onLayout : undefined}
                style={({ pressed }) => [styles.entryCard, c.primary ? styles.entryCardPrimary : styles.entryCardPlain, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t(c.title)}
                ph-label={`reading_entry_${c.key}`}
                onPress={() => goEntry(c.key)}>
                <View style={styles.entryArt}>
                  {ENTRY_ART[c.key] != null ? (
                    <Image source={ENTRY_ART[c.key]} style={styles.entryArtImg} resizeMode="contain" accessibilityElementsHidden />
                  ) : (
                    <View style={styles.entryTile}>
                      <MaterialCommunityIcons name="auto-fix" size={26} color={palette.onAccent} />
                    </View>
                  )}
                </View>
                <View style={styles.entryBody}>
                  <Text style={[styles.entryTitle, c.primary && styles.onAccent]}>{t(c.title)}</Text>
                  <Text style={[styles.entrySub, c.primary && styles.onMediaSub]}>{t(c.sub)}</Text>
                </View>
                <View style={[styles.entryGo, !c.primary && styles.entryGoPlain]}>
                  <Feather name="chevron-right" size={18} color={palette.blue} />
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <>
          {resume && !searching && (
            <View style={styles.resumeCard}>
              <Feather name="moon" size={22} color={palette.onAccent} style={styles.resumeMoon} />
              <Image source={HERO_ACTY} style={styles.resumeActy} resizeMode="contain" accessibilityElementsHidden />
              <Text style={styles.resumeEyebrow}>{t('reading.resumeEyebrow')}</Text>
              <Text style={styles.resumeTitle}>
                {t('reading.resumeHeadline', {
                  title: resume.script.title,
                  roles: myCharactersLabel(resume.script),
                  done: resume.session.progress?.done ?? 0,
                  total: resume.session.progress?.total ?? 0,
                })}
              </Text>
              <Text style={styles.resumeHint}>{t('reading.resumeHint')}</Text>
              <Pressable
                style={({ pressed }) => [styles.resumeBtn, pressed && styles.pressed]}
                onPress={() => void continueReading()}
                disabled={resuming}
                accessibilityRole="button">
                <Text style={styles.resumeBtnText}>{resuming ? t('loadingText.preparing') : t('reading.resumeGo')}</Text>
                {!resuming && <Feather name="arrow-right" size={16} color={palette.blueDeep} />}
              </Pressable>
            </View>
          )}

          <AdSlot slot="reading_tab_top" />

          {list && (
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('reading.uploadedTitle')}</Text>
              <Text style={styles.sectionCount}>{t('reading.uploadedCount', { count: list.total_count })}</Text>
            </View>
          )}
          {/* pen R1.3·R1.4 — 검색칸은 「업로드한 대본」 머리 아래, 목록 바로 위에 둔다. */}
          <View style={styles.search}>
            <Feather name="search" size={18} color={palette.iconFaint} />
            <TextInput
              style={styles.searchInput}
              value={q}
              onChangeText={setQ}
              placeholder={t('reading.searchPlaceholder')}
              placeholderTextColor={palette.textMeta}
            />
          </View>
          {loading && !list && (
            <SkeletonRows count={6} avatar card={false} />
          )}
          <View style={styles.list}>
            {scripts.map((s) => {
              const chip = statusChip(s);
              const tone = chip ? CHIP_TONE[chip.tone] : null;
              return (
                <Pressable
                  key={s.id}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  onPress={() => void open(s)}
                  onLongPress={(e) => more(s, e)}>
                  <View style={styles.rowIcon}>
                    <Feather name="file-text" size={20} color={palette.blue} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{s.title}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {chip && tone ? <Text style={[styles.rowChip, { color: tone.color }]}>{`${chip.label} · `}</Text> : null}
                      {myCharactersLabel(s)} · {t('reading.dialogueCount', { count: s.dialogue_count })}
                    </Text>
                  </View>
                  <Pressable style={styles.moreBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('reading.more')} ph-label="reading_script_more" onPress={(e) => more(s, e)}>
                    <Feather name="more-horizontal" size={18} color={palette.iconFaint} />
                  </Pressable>
                </Pressable>
              );
            })}
            {scripts.length === 0 && searching && <InlineEmpty title={t('reading.noMatch')} description={t('reading.noMatchSub')} />}
          </View>
        </>
      )}
      {dialog}
      {cloudVoice.consentSheet}
      <TitleEditDialog
        script={editing}
        onClose={(saved) => {
          setEditing(null);
          if (saved) void load(q);
        }}
      />

      {/* 가이드는 제 창에 뜬다 — 목록 어디에 두든 자리를 차지하지 않는다. */}
      <SpotlightGuide
        visible={guideOpen && !!list && !hasScripts}
        topic="reading"
        steps={READING_STEPS}
        onDone={() => {
          setGuideOpen(false);
          void markSpotlightSeen('reading');
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  content: { paddingHorizontal: space.gutter, gap: space[3] },
  headWrap: { marginHorizontal: -space.gutter },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  voiceBar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.full,
    paddingLeft: space[3],
    paddingRight: space[1],
  },
  voiceText: { ...type.captionBold, flex: 1, color: palette.text },
  voiceBadgeText: { ...type.micro, color: palette.blueDeep },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    height: 48,
  },
  searchInput: { ...type.body1, lineHeight: undefined, flex: 1, color: palette.text, padding: 0 },
  entry: { gap: space[4] },
  emptyBg: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: palette.blueSoft, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  hero: { height: 188, flexDirection: 'row', alignItems: 'center' },
  heroText: { flex: 1, gap: space[3] },
  heroTitle: { ...type.display, color: palette.text },
  heroSub: { ...type.body2, color: palette.textSub },
  heroActy: { width: 170, height: 188 },
  entryCards: { gap: space[3], paddingTop: space[2] },
  entryCard: { minHeight: 108, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4] },
  entryCardPrimary: { backgroundColor: palette.blue },
  entryCardPlain: { backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border },
  entryArt: { width: 68, height: 76, alignItems: 'center', justifyContent: 'center' },
  entryArtImg: { width: 68, height: 76 },
  entryTile: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  entryBody: { flex: 1, gap: space[1] },
  entryTitle: { ...type.body1Bold, color: palette.text },
  entrySub: { ...type.caption, color: palette.textMeta },
  onAccent: { color: palette.onAccent },
  onMediaSub: { color: palette.onMediaSub },
  entryGo: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  entryGoPlain: { borderWidth: 1, borderColor: palette.border },
  resumeCard: { backgroundColor: palette.blue, borderRadius: radius.lg, padding: space[5], gap: space[2], overflow: 'hidden' },
  resumeMoon: { position: 'absolute', right: space[5], top: space[5] },
  resumeActy: { position: 'absolute', right: 0, bottom: 0, width: 96, height: 106 },
  resumeEyebrow: { ...type.caption, color: palette.onMediaSub },
  resumeTitle: { ...type.title2, color: palette.onAccent, maxWidth: '78%' },
  resumeHint: { ...type.caption, color: palette.onMediaSub, maxWidth: '64%' },
  resumeBtn: {
    alignSelf: 'flex-start',
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    backgroundColor: palette.bg,
    borderRadius: radius.full,
    paddingHorizontal: space[4],
    marginTop: space[1],
  },
  resumeBtnText: { ...type.body2Bold, color: palette.blueDeep },
  pressed: { opacity: 0.85 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[2] },
  sectionTitle: { ...type.headline, color: palette.text },
  sectionCount: { ...type.caption, color: palette.textMeta },
  list: { gap: 0 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  rowIcon: { width: 24, alignItems: 'center' },
  rowBody: { flex: 1, minWidth: 0, gap: space[1] },
  rowTitle: { ...type.body1Bold, color: palette.text },
  rowMeta: { ...type.caption, color: palette.textMeta },
  rowChip: type.captionBold,
  moreBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
