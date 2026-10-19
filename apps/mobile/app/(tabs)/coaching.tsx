import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { EntryRow } from '@/components/ui/entry-row';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { coachingEntry, type CoachingEntry } from '@/lib/practice/coaching-entry';
import { continueActionFor } from '@/lib/practice/resume';
import { setContinueOrigin } from '@/lib/practice/session-state';

const MASCOT = require('@/assets/images/mascot-coach.png');

/**
 * 코칭 탭(pen 「새 · 코칭 입구 첫/다음」, SOMA-748). 가운데 촬영 버튼을 대신해 코칭을 시작하는 곳이다.
 *
 * 서버 기능이 아직 없는 길(영상 없이 말로 코칭, 찍을 대사 같이 만들기, 하루 무료 횟수 안내)은 디자인에
 * 있지만 이번엔 보이지 않는다.
 */
export default function CoachingTab() {
  const router = useRouter();
  const [entry, setEntry] = useState<CoachingEntry | null>(null);
  const [nextTake, setNextTake] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .listPracticeGroups('all')
        .then(({ groups }) => {
          if (cancelled) return;
          const next = coachingEntry(groups);
          setEntry(next);
          if (next.kind === 'next' && next.notePracticeId) {
            api
              .getPracticeNote(next.notePracticeId)
              .then((note) => {
                if (!cancelled) setNextTake(note.next_take);
              })
              .catch(() => {
                if (!cancelled) setNextTake(null);
              });
          }
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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('coachingTab.title')}</Text>
      </View>
      {!entry ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : entry.kind === 'first' ? (
        <View style={styles.firstBody}>
          <MascotBubble source={MASCOT} title={t('coachingTab.firstBubble')} body={t('coachingTab.firstBubbleSub')} />
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
            <Text style={styles.cardEyebrow}>{t('coachingTab.lastNext')}</Text>
            <Text style={styles.cardTitle}>{entry.noteTitle ?? entry.group.title ?? t('coachingTab.untitled')}</Text>
            {nextTake ? <Text style={styles.cardBody}>{nextTake}</Text> : null}
            <Text style={styles.cardGuide}>{t('coachingTab.againGuide')}</Text>
            <PrimaryButton label={t('coachingTab.again')} onPress={again} />
          </View>
          <Text style={styles.sectionLabel}>{t('coachingTab.others')}</Text>
          <EntryRow icon="video" title={t('coachingTab.newVideo')} sub={t('coachingTab.newVideoSub')} onPress={startNew} />
          <EntryRow icon="clock" title={t('coachingTab.history')} sub={t('coachingTab.historySub')} onPress={() => router.push('/history')} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: { height: 52, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: palette.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // 아래 탭 바가 화면 위에 떠 있어 그만큼 바닥을 비운다.
  firstBody: { flex: 1, paddingTop: 16, paddingHorizontal: 24, paddingBottom: 120, gap: 14 },
  firstQuestion: { marginTop: 24, gap: 8 },
  question: { fontSize: 22, fontWeight: '800', lineHeight: 30, color: palette.text },
  guide: { fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.blueDeep },
  spacer: { flex: 1 },
  nextBody: { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 120, gap: 14 },
  card: { backgroundColor: palette.blueMist, borderRadius: 18, padding: 16, gap: 10 },
  cardEyebrow: { fontSize: 13, fontWeight: '800', lineHeight: 20, color: palette.blue },
  cardTitle: { fontSize: 19, fontWeight: '800', lineHeight: 28, color: palette.text },
  cardBody: { fontSize: 14, fontWeight: '500', lineHeight: 21, color: palette.textDim },
  cardGuide: { fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.blueDeep },
  sectionLabel: { marginTop: 10, fontSize: 14, fontWeight: '800', color: palette.textFaint },
});
