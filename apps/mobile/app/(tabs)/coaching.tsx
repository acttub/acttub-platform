import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChoiceCard } from '@/components/choice-card';
import { PrimaryButton } from '@/components/ui/buttons';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { MASCOT } from '@/components/ui/mascot';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { palette } from '@/constants/palette';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { coachingEntry, type CoachingEntry } from '@/lib/practice/coaching-entry';
import { sceneTitle } from '@/lib/practice/groups';

/** 처음 화면의 입구 셋(pen 「코칭 탭 · 처음」). */
const ENTRY_CHOICES = ['video', 'talk', 'script'] as const;
type EntryChoice = (typeof ENTRY_CHOICES)[number];

/**
 * 코칭 탭(pen 「코칭 탭 · 처음」·「다음 연습」·「하던 코칭 이어서」). 가운데 촬영 버튼을 대신해 코칭을 시작하는 곳이다.
 *
 * - 처음: 액티 말풍선 「어떻게 코칭 받을래요?」 + 고르는 카드 셋(영상 보여 주고 / 영상 없이 말로 / 찍을 대사부터 같이 만들기).
 *   기본 선택은 없고, 고른 뒤 아래 「다음」을 눌러야 넘어간다(선택 규칙).
 * - 다음 연습: 입구 목록 — 새 영상으로 · 이전 코칭 이어 하기 · 영상 없이 말로 · 찍을 대사부터 · 연습 기록 보기.
 * - 하던 코칭: 맨 위에 「하던 코칭 이어 하기」 줄이 파랗게 놓이고 나머지는 같다.
 *
 * 디자인의 「2개 남음」 같은 남은 횟수는 서버에 그 값이 없어 그리지 않고, 장면 제목만 보조 글로 둔다.
 * 「찍을 대사부터 같이 만들기」는 리딩 영역의 script-cocreate 로 연결만 한다.
 */
export default function CoachingTab() {
  const tabBarSpace = useTabBarSpace();
  const router = useRouter();
  const firstTime = useFirstTimeUser();
  const [entry, setEntry] = useState<CoachingEntry | null>(null);
  const [choice, setChoice] = useState<EntryChoice | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .listPracticeGroups('all')
        .then(({ groups: list }) => {
          if (cancelled) return;
          setChoice(null);
          setEntry(coachingEntry(list));
        })
        .catch(() => {
          if (!cancelled) setEntry({ kind: 'first' });
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const first = entry?.kind === 'first';
  // 새 연습은 세션 목적 → 영상 고르기 순서다(app/upload). 첫 코칭이면 단계마다 파란 안내를 켠다.
  const startNew = () => router.push({ pathname: '/upload', params: first ? { first: '1' } : {} });
  // 「하던 코칭 이어 하기」는 열린 대화로, 「이전 코칭 이어 하기」는 지난 코칭 목록에서 고른다.
  const again = () => {
    if (entry?.kind === 'resume') {
      const open = entry.group.in_progress_practice_id;
      if (open) router.push({ pathname: '/coach', params: { practiceId: open } });
      return;
    }
    router.push('/history');
  };
  const resuming = entry?.kind === 'resume';

  // 처음 화면의 「다음」 — 고른 입구로 간다. 「영상 보여 주고」는 새 연습(목적 → 영상) 흐름이다.
  const goChoice = () => {
    if (choice === 'video') startNew();
    else if (choice === 'talk') router.push('/talk');
    else if (choice === 'script') router.push('/script-cocreate');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* 첫 사용자 홈에서 이 길을 고른 뒤에도 홈(뭐부터 해 볼까요?)으로 돌아가 다른 길을 고를 수 있다(SOMA-771). */}
      <NavHeader
        title={t('coachingTab.title')}
        // 탭바가 보이면 하단 탭으로 홈에 갈 수 있어 뒤로를 두지 않는다 — 탭바를 숨긴 첫 사용자만(10/22 피드백).
        left={firstTime ? <NavIconButton icon="chevron-left" size={24} label={t('common.back')} phLabel="coaching_back_home" onPress={() => router.navigate('/')} /> : undefined}
        right={
          // 첫 사용자는 탭바가 숨어 프로필 탭의 설정으로 못 간다 — 로그아웃·탈퇴 길을 남긴다(SOMA-781).
          firstTime && first ? (
            <NavIconButton icon="settings" size={24} label={t('settings.title')} phLabel="coaching_first_settings" onPress={() => router.push('/settings')} />
          ) : undefined
        }
      />
      {!entry ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : entry.kind === 'first' ? (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.firstBody}>
            <MascotBubble source={MASCOT.slate} title={t('coachingTab.chooseBubble')} guide={t('coachingTab.chooseGuide')} />
            <View style={styles.choices}>
              {ENTRY_CHOICES.map((key) => (
                <ChoiceCard
                  key={key}
                  title={t(`coachingTab.choice.${key}`)}
                  sub={t(`coachingTab.choiceSub.${key}`)}
                  selected={choice === key}
                  phLabel={`coaching_first_${key}`}
                  onPress={() => setChoice(key)}
                />
              ))}
            </View>
          </ScrollView>
          <View style={[styles.firstFooter, { paddingBottom: 21 + tabBarSpace }]}>
            <PrimaryButton label={t('coachingTab.next')} phLabel="coaching_first_next" disabled={!choice} onPress={goChoice} />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.nextBody, { paddingBottom: tabBarSpace + 20 }]}>
          <MascotBubble
            source={MASCOT.slate}
            title={t(resuming ? 'coachingTab.resumeBubble' : 'coachingTab.nextBubble')}
            guide={null}
          />
          <View style={styles.menu}>
            {resuming ? (
              <MenuRow
                icon="clock"
                title={t('coachingTab.resumeRow')}
                sub={sceneTitle(entry.group)}
                highlight
                phLabel="coaching_resume"
                onPress={again}
              />
            ) : null}
            <MenuRow icon="video" title={t('coachingTab.menuNewVideo')} sub={t('coachingTab.menuNewVideoSub')} phLabel="coaching_new_video" onPress={startNew} />
            {resuming ? null : (
              <MenuRow icon="clock" title={t('coachingTab.menuResume')} sub={t('coachingTab.menuResumeSub')} phLabel="coaching_pick_previous" onPress={again} />
            )}
            <MenuRow icon="message-circle" title={t('coachingTab.menuTalk')} sub={t('coachingTab.menuTalkSub')} phLabel="coaching_talk" onPress={() => router.push('/talk')} />
            <MenuRow icon="edit-3" title={t('coachingTab.menuScript')} sub={t('coachingTab.menuScriptSub')} phLabel="coaching_script_cocreate" onPress={() => router.push('/script-cocreate')} />
            <MenuRow icon="list" title={t('coachingTab.menuHistory')} sub={t('coachingTab.menuHistorySub')} phLabel="coaching_history" onPress={() => router.push('/history')} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** 코칭 탭 목록 한 줄 — 파란 아이콘, 제목 17/700, 보조 14, 오른쪽 꺾쇠. 하던 코칭이 있으면 그 줄만 파랗게 칠한다. */
function MenuRow({
  icon,
  title,
  sub,
  highlight,
  phLabel,
  onPress,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  sub?: string;
  highlight?: boolean;
  phLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      ph-label={phLabel}
      style={({ pressed }) => [styles.menuRow, highlight && styles.menuRowOn, pressed && styles.pressed]}>
      <Feather name={icon} size={24} color={palette.blue} />
      <View style={styles.flex}>
        <Text style={[styles.menuTitle, highlight && styles.menuTitleOn]}>{title}</Text>
        {sub ? (
          <Text style={styles.menuSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={20} color={palette.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85 },

  // 처음(pen 「코칭 탭 · 처음」) — 말풍선 + 고르는 카드 셋 + 아래 「다음」.
  firstBody: { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 16, gap: 28 },
  choices: { gap: 8 },
  firstFooter: { paddingHorizontal: 24 },

  // 다음 연습·하던 코칭(pen 「코칭 탭 · 다음 연습」·「하던 코칭 이어서」) — 말풍선 + 입구 목록.
  nextBody: { paddingTop: 16, paddingHorizontal: 24, gap: 20 },
  menu: { gap: 8 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 18, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5, borderColor: 'transparent' },
  menuRowOn: { borderColor: palette.blue, backgroundColor: palette.blueSoft },
  menuTitle: { fontSize: 17, fontWeight: '700', lineHeight: 23, color: palette.text },
  menuTitleOn: { color: palette.blueDeep },
  menuSub: { marginTop: 3, fontSize: 14, fontWeight: '500', lineHeight: 21, color: palette.textFaint },
});
