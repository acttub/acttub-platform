import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SpotlightGuide, type SpotlightStep } from '@/components/spotlight-guide';
import { palette } from '@/constants/palette';
import { useCloudVoice } from '@/hooks/use-cloud-voice';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { hasSeenReadingTutorial, hasSeenSpotlight, markReadingTutorialSeen, markSpotlightSeen } from '@/lib/guide-state';
import { finishTutorial } from '@/hooks/use-tutorial-spotlight';
import { currentTutorial } from '@/lib/tutorial';
import { TARGET } from '@/lib/spotlight-targets';
import { useAppDialog } from '@/components/app-dialog';
import { TitleEditDialog } from '@/components/title-edit-dialog';
import { LargeTitleHeader, NavIconButton } from '@/components/ui/nav-header';
import { IconOptionRow } from '@/components/ui/option-card';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { CHIP_TONE, myCharactersLabel, statusChip } from '@/lib/reading/script-cards';
import { resumeCandidate, resumeSessionOf } from '@/lib/reading/redesign-748';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { deleteScript, fetchSession, listScripts, listSessions, loadIntoCurrent, setCurrentSession } from '@/lib/reading/store';
import type { ScriptCard, ScriptListResponse, SessionCard } from '@/lib/reading/types';
import { isKorean, translate as t } from '@/lib/i18n';

/**
 * 내 대본 목록(R00, reading.script). 서버 목록이 정본이다 — 최근 고친 순, 머리 "전체 N개 · 연습 중 M개",
 * 카드마다 제목·내 배역·대사 수·녹음 수·마지막 활동·상태 칩(연습 중·연습 완료, 배역을 안 골랐으면 없음). 검색은 서버가
 * 제목과 배역 이름만 찾는다. "분석 완료" 칩은 리딩에 분석이 없어 없다.
 */
const SEARCH_DEBOUNCE_MS = 300;

const MASCOT = require('@/assets/images/mascot-reading.png');

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
  const [searchOpen, setSearchOpen] = useState(false);
  /** 「이전에 하던 데부터」 카드 — 연습 중 대본의 진행 중 회차(pen 「새 · 내 대본」). */
  const [resume, setResume] = useState<{ script: ScriptCard; session: SessionCard } | null>(null);
  const [resuming, setResuming] = useState(false);
  const generation = useRef(0);
  // 대본 탭에서 처음 한 번만 — 홈 가이드와 따로 센다 (SOMA-550).
  const [guideOpen, setGuideOpen] = useState(false);
  // 안내는 앱 맨 바깥에 그려져 다른 화면 위에도 덮인다 — 이 탭이 보일 때만 연다.
  const guideFocused = useRef(false);
  const newTarget = useSpotlightTarget(TARGET.readingNew);

  const openReadingGuideIfNew = useCallback(() => {
    void hasSeenSpotlight('reading').then((seen) => {
      if (!seen && guideFocused.current) setGuideOpen(true);
    });
  }, []);

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
  const more = (s: ScriptCard) =>
    void sheet({
      title: s.title,
      actions: [
        { label: t('reading.editAction'), onPress: () => setEditing(s) },
        { label: t('reading.deleteAction'), destructive: true, onPress: () => void remove(s) },
      ],
    });

  const scripts = list?.scripts ?? [];
  const searching = q.trim().length > 0;
  const empty = !!list && scripts.length === 0 && !searching;

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

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top, paddingBottom: tabBarSpace + 20 }]}
      keyboardShouldPersistTaps="handled">
      {/* pen 「헤더 / 큰 제목」 — 대본이 없으면 「대본」, 있으면 「내 대본」. 첫 사용자는 탭바가 숨으므로 홈(뭐부터 해 볼까요?)으로
          돌아갈 꺾쇠를 단다 — 탭바가 보이면 두지 않는다. */}
      <View style={styles.headWrap}>
        <LargeTitleHeader
          title={empty ? t('reading.tabTitle') : t('reading.listTitle')}
          onBack={firstTime ? () => router.navigate('/') : undefined}
          backPhLabel="reading_back_home"
          right={
            <View style={styles.headRight}>
              {/* 탭바가 숨어 프로필 탭의 설정으로 못 가므로 로그아웃·탈퇴 길을 남긴다(SOMA-781). */}
              {firstTime && (
                <NavIconButton icon="settings" size={24} label={t('settings.title')} phLabel="reading_first_settings" onPress={() => router.push('/settings')} />
              )}
              {!empty && (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('reading.search')}
                  ph-label="reading_search"
                  onPress={() => setSearchOpen((v) => !v || searching)}>
                  <Feather name="search" size={22} color={palette.text} />
                </Pressable>
              )}
              {!empty && (
                <Pressable
                  ref={newTarget.ref}
                  onLayout={newTarget.onLayout}
                  style={styles.newBtn}
                  accessibilityRole="button"
                  onPress={() => router.push('/reading/new')}>
                  <Feather name="plus" size={16} color={palette.onAccent} />
                  <Text style={styles.newText}>{t('reading.titleNew')}</Text>
                </Pressable>
              )}
            </View>
          }
        />
      </View>

      {!empty && (searchOpen || searching) && (
        <View style={styles.search}>
          <Feather name="search" size={16} color={palette.textFaint} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            autoFocus={!searching}
            placeholder={t('reading.searchPlaceholder')}
            placeholderTextColor={palette.textFaint}
          />
        </View>
      )}

      {/* 고품질 목소리 켜기(SOMA-664, 디자인 R1.2) — 설정 화면에서 옮겨 왔다. 서버가 쓸 수 없다고 하면 숨긴다. */}
      {cloudVoice.status?.available && (
        <View style={styles.voiceBar}>
          <Feather name="volume-2" size={16} color={palette.blue} />
          <Text style={styles.voiceText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
            {t('cloudVoice.bannerLabel')}
          </Text>
          {!!voiceFreeUntil && (
            <View style={styles.voiceBadge}>
              <Text style={styles.voiceBadgeText}>{t('cloudVoice.bannerFree', { date: voiceFreeUntil })}</Text>
            </View>
          )}
          <Switch
            value={cloudVoice.enabled && cloudVoice.status.consent === 'granted'}
            onValueChange={(value) => void (value ? cloudVoice.enable('settings') : cloudVoice.disable())}
            disabled={cloudVoice.busy}
            trackColor={{ true: palette.blue, false: palette.border }}
            thumbColor={palette.onAccent}
            ios_backgroundColor={palette.border}
          />
        </View>
      )}

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{t('reading.listLoadFail')}</Text>
          <Pressable onPress={() => void load(q)}>
            <Text style={styles.retry}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      )}

      {loading && !list ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : empty ? (
        // pen 「새 · 리딩 입구 첫」 — AI 대본 생성 입구는 서버 기능이 없어 숨긴다(SOMA-748).
        <View style={styles.entry}>
          <MascotBubble source={MASCOT} title={t('reading.entryBubble')} guide={t('reading.entryBubbleSub')} />
          <View ref={newTarget.ref} onLayout={newTarget.onLayout}>
            <IconOptionRow flush icon="upload" title={t('reading.entryUpload')} sub={t('reading.entryUploadSub')} onPress={() => router.push('/reading/new')} />
          </View>
          {/* 대본이 없어도 바로 — 대본 넣기 화면을 예시 대본으로 채워 연다(pen 「대본 탭」). */}
          <IconOptionRow
            flush
            icon="file-text"
            title={t('reading.entrySample')}
            sub={t('reading.entrySampleSub')}
            phLabel="reading_entry_sample"
            onPress={() => router.push({ pathname: '/reading/new', params: { sample: '1' } })}
          />
        </View>
      ) : (
        <>
          {resume && !searching && (
            <View style={styles.resumeCard}>
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
                {resuming ? <ActivityIndicator size="small" color={palette.blueDeep} /> : <Text style={styles.resumeBtnText}>{t('reading.resumeGo')}</Text>}
                <Feather name="arrow-right" size={18} color={palette.blueDeep} />
              </Pressable>
            </View>
          )}

          {list && (
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('reading.uploadedTitle')}</Text>
              <Text style={styles.sectionCount}>{t('reading.uploadedCount', { count: list.total_count })}</Text>
            </View>
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
                  onLongPress={() => more(s)}>
                  <View style={styles.rowIcon}>
                    <Feather name="file-text" size={20} color={palette.blue} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{s.title}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {myCharactersLabel(s)} · {t('reading.dialogueCount', { count: s.dialogue_count })}
                      {chip && tone ? <Text style={{ color: tone.color }}>{` · ${chip.label}`}</Text> : null}
                    </Text>
                  </View>
                  <Pressable style={styles.moreBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('reading.more')} ph-label="reading_script_more" onPress={() => more(s)}>
                    <Feather name="more-horizontal" size={18} color={palette.textFaint} />
                  </Pressable>
                </Pressable>
              );
            })}
            {scripts.length === 0 && searching && <Text style={styles.noMatch}>{t('reading.noMatch')}</Text>}
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
        visible={guideOpen}
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
  content: { paddingHorizontal: 20, gap: 12 },
  // 큰 제목 머리는 제 안쪽 여백(28)을 가지므로 목록 여백(20)을 거둔다.
  headWrap: { marginHorizontal: -20 },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.blue, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  newText: { color: palette.onAccent, fontSize: 14, fontWeight: '800' },
  // pen 「AI 목소리 배너」 — 높이 39, 모서리 20, 옅은 파랑 바탕, 글 12.5/700, 무료 배지 모서리 8.
  voiceBar: {
    minHeight: 39,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.blueMist,
    borderRadius: 20,
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 4,
  },
  voiceText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: palette.text },
  voiceBadge: { backgroundColor: palette.blueSoft, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  voiceBadgeText: { fontSize: 12.5, fontWeight: '700', color: palette.blueDeep },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.bgSoft, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  searchInput: { flex: 1, color: palette.text, fontFamily: 'Pretendard', fontSize: 14, padding: 0 },
  errorBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.dangerSoft, borderRadius: 12, padding: 12 },
  errorText: { color: palette.danger, fontFamily: 'Pretendard', fontSize: 13 },
  retry: { color: palette.danger, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  loading: { alignItems: 'center', paddingVertical: 60 },
  entry: { gap: 6, marginTop: 1 },
  resumeCard: { backgroundColor: palette.blue, borderRadius: 22, padding: 20, gap: 10 },
  resumeEyebrow: { color: palette.blueLine, fontSize: 13, fontWeight: '800', lineHeight: 20 },
  resumeTitle: { color: palette.onAccent, fontSize: 22, fontWeight: '900', lineHeight: 31 },
  resumeHint: { color: palette.blueSoft, fontSize: 14, fontWeight: '700', lineHeight: 21 },
  resumeBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.card, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, marginTop: 4 },
  resumeBtnText: { color: palette.blueDeep, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.85 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  sectionTitle: { color: palette.text, fontSize: 16, fontWeight: '800', lineHeight: 24 },
  sectionCount: { color: palette.textFaint, fontSize: 13, fontWeight: '600' },
  list: { gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 4 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0, gap: 6 },
  rowTitle: { color: palette.text, fontSize: 16, fontWeight: '800', lineHeight: 24 },
  rowMeta: { color: palette.textFaint, fontSize: 13, fontWeight: '600', lineHeight: 20 },
  moreBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  noMatch: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 14, textAlign: 'center', paddingVertical: 24 },
});
