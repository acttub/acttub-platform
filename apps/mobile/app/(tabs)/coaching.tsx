import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { IconOptionRow } from '@/components/ui/option-card';
import { MASCOT } from '@/components/ui/mascot';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { palette } from '@/constants/palette';
import { useNextTakes } from '@/hooks/use-next-takes';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { coachingEntry, type CoachingEntry } from '@/lib/practice/coaching-entry';
import { sceneTitle } from '@/lib/practice/groups';
import { continueActionFor } from '@/lib/practice/resume';
import { setContinueOrigin } from '@/lib/practice/session-state';


/**
 * 코칭 탭(pen 「새 · 코칭 입구 첫/다음」, SOMA-748). 가운데 촬영 버튼을 대신해 코칭을 시작하는 곳이다.
 *
 * 서버 기능이 아직 없는 길(영상 없이 말로 코칭, 찍을 대사 같이 만들기, 하루 무료 횟수 안내)은 디자인에
 * 있지만 이번엔 보이지 않는다.
 */
export default function CoachingTab() {
  const router = useRouter();
  const [entry, setEntry] = useState<CoachingEntry | null>(null);
  // 「지난번 다음에 해볼 것」은 노트의 다음 테이크 문장이다. 없으면 그 칸을 띄우지 않는다.
  const takes = useNextTakes([entry?.kind === 'next' ? entry.notePracticeId : null]);
  const nextTake = entry?.kind === 'next' ? takes[entry.notePracticeId] ?? null : null;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .listPracticeGroups('all')
        .then(({ groups }) => {
          if (!cancelled) setEntry(coachingEntry(groups));
        })
        .catch(() => {
          if (!cancelled) setEntry({ kind: 'first' });
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // 새 연습은 세션 목적 → 영상 고르기 → 장면 순서다(app/upload). 첫 코칭이면 단계마다 파란 안내를 켠다.
  const startNew = () => router.push({ pathname: '/upload', params: entry?.kind === 'first' ? { first: '1' } : {} });

  const again = () => {
    if (entry?.kind !== 'next') return;
    const action = continueActionFor(entry.group);
    if (action.kind === 'resume') {
      router.push({ pathname: '/analyzing', params: { practiceId: action.practiceId } });
      return;
    }
    const last = entry.group.practices[entry.group.practices.length - 1];
    setContinueOrigin({ kind: 'group', rootId: entry.group.root_id, practiceId: last?.id ?? entry.group.root_id });
    router.push('/upload');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* 첫 사용자 홈에서 이 길을 고른 뒤에도 홈(뭐부터 해 볼까요?)으로 돌아가 다른 길을 고를 수 있다(SOMA-771). */}
      <NavHeader
        title={t('coachingTab.title')}
        left={<NavIconButton icon="chevron-left" label={t('common.back')} phLabel="coaching_back_home" onPress={() => router.navigate('/')} />}
      />
      {!entry ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : entry.kind === 'first' ? (
        <View style={styles.firstBody}>
          <MascotBubble source={MASCOT.coach} title={t('coachingTab.firstBubble')} body={t('coachingTab.firstBubbleSub')} />
          <View style={styles.firstQuestion}>
            <Text style={styles.question}>{t('coachingTab.firstQuestion')}</Text>
            <Text style={styles.guide}>{t('coachingTab.firstGuide')}</Text>
          </View>
          <View style={styles.spacer} />
          <PrimaryButton label={t('coachingTab.withVideo')} onPress={startNew} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.nextBody}>
          <View style={styles.card}>
            {nextTake ? <Text style={styles.cardEyebrow}>{t('coachingTab.lastNext')}</Text> : null}
            <Text style={styles.cardTitle}>{nextTake ?? sceneTitle(entry.group)}</Text>
            {nextTake ? <Text style={styles.cardBody}>{sceneTitle(entry.group)}</Text> : null}
            <Text style={styles.cardGuide}>{t('coachingTab.againGuide')}</Text>
            <PrimaryButton label={t('coachingTab.again')} onPress={again} />
          </View>
          <Text style={styles.sectionLabel}>{t('coachingTab.others')}</Text>
          <IconOptionRow flush icon="video" title={t('coachingTab.newVideo')} sub={t('coachingTab.newVideoSub')} onPress={startNew} />
          <IconOptionRow flush icon="clock" title={t('coachingTab.history')} sub={t('coachingTab.historySub')} onPress={() => router.push('/history')} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // 아래 탭 바가 화면 위에 떠 있어 그만큼 바닥을 비운다.
  firstBody: { flex: 1, paddingTop: 16, paddingHorizontal: 24, paddingBottom: 120, gap: 14 },
  firstQuestion: { marginTop: 38, gap: 14 },
  question: { fontSize: 22, fontWeight: '800', lineHeight: 30, color: palette.text },
  guide: { fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.blueDeep },
  spacer: { flex: 1 },
  nextBody: { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 120, gap: 14 },
  card: { backgroundColor: palette.blueMist, borderRadius: 18, padding: 16, gap: 10 },
  cardEyebrow: { fontSize: 13, fontWeight: '800', lineHeight: 20, color: palette.blue },
  cardTitle: { fontSize: 19, fontWeight: '800', lineHeight: 28, color: palette.text },
  cardBody: { fontSize: 14, fontWeight: '500', lineHeight: 21, color: palette.textDim },
  cardGuide: { fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.blueDeep },
  sectionLabel: { fontSize: 14, fontWeight: '800', lineHeight: 21, color: palette.textFaint },
});
