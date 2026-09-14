import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * A15/A16 챌린지(대사) 탭 — 유명 대사를 연기해 좋아요 랭킹을 겨루는 소셜 피드.
 *
 * 백엔드가 아직 없어 예시(목업) 데이터로 화면만 보여준다(previewNote로 명시). 서버 계약이
 * 서면 목록·오늘의 대사·랭킹을 실제 API로 바꾼다.
 */

const TODAY = {
  line: '가지 마, 딱 한 번만 내 얘기 듣고 가.',
  work: '옥상, 밤',
  roles: ['윤서', '태오', '민재', '수아'],
  plays: '1천',
  likes: '12천',
};

const RANKING: { line: string; work: string; likes: string }[] = [
  { line: '네가 먼저 말했잖아, 같이 가자고, 어디든.', work: '가로등 아래', likes: '8.2천' },
  { line: '나 다시 돌아왔다니까!?', work: '재회', likes: '5.1천' },
  { line: '이렇게 사랑이 변하니.', work: '겨울 끝', likes: '4.7천' },
  { line: '괜찮아, 이제 그만 울어도 돼.', work: '병실 305호', likes: '4.4천' },
  { line: '한 번만 더 믿어보면 안 될까.', work: '마지막 밤', likes: '3.9천' },
];

const TABS = ['tabRanking', 'tabLatest', 'tabMine'] as const;

export default function ChallengesScreen() {
  const [tab, setTab] = useState(0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('challenges.title')}</Text>
        <View style={styles.headerRight}>
          <View style={styles.myChip}>
            <Feather name="award" size={13} color={palette.blueDeep} />
            <Text style={styles.myChipText}>{t('challenges.myChallenge')}</Text>
          </View>
          <Pressable style={styles.addBtn} accessibilityRole="button">
            <Feather name="plus" size={20} color={palette.text} />
          </Pressable>
        </View>
      </View>

      <View style={styles.search}>
        <Feather name="search" size={15} color={palette.textFaint} />
        <Text style={styles.searchPh}>{t('challenges.searchPh')}</Text>
      </View>

      <View style={styles.tabRow}>
        {TABS.map((key, i) => (
          <Pressable key={key} style={styles.tab} onPress={() => setTab(i)}>
            <Text style={[styles.tabText, tab === i && styles.tabTextOn]}>{t(`challenges.${key}`)}</Text>
            {tab === i && <View style={styles.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.previewNote}>
          <Feather name="info" size={13} color={palette.blueDeep} />
          <Text style={styles.previewText}>{t('challenges.previewNote')}</Text>
        </View>

        {/* 오늘의 대사 */}
        <Text style={styles.sectionLabel}>{t('challenges.todayLabel')}</Text>
        <View style={styles.todayCard}>
          <Text style={styles.todayLine}>“{TODAY.line}”</Text>
          <Text style={styles.todayWork}>{TODAY.work}</Text>
          <View style={styles.thumbRow}>
            {TODAY.roles.map((r) => (
              <View key={r} style={styles.thumb}>
                <Feather name="video" size={16} color={palette.textFaint} />
                <Text style={styles.thumbLabel}>{r}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.todayStat}>
            {t('challenges.statLine', { plays: TODAY.plays, likes: TODAY.likes })}
          </Text>
          <Pressable style={styles.performBtn} accessibilityRole="button">
            <Feather name="play" size={15} color="#FFFFFF" />
            <Text style={styles.performText}>{t('challenges.performCta')}</Text>
          </Pressable>
        </View>

        {/* 랭킹 목록 */}
        <View style={styles.list}>
          {RANKING.map((item, i) => (
            <View key={item.line} style={styles.row}>
              <Text style={styles.rank}>{i + 1}</Text>
              <View style={styles.rowBody}>
                <Text style={styles.rowLine} numberOfLines={1}>“{item.line}”</Text>
                <Text style={styles.rowWork}>{item.work}</Text>
              </View>
              <View style={styles.likeChip}>
                <Feather name="heart" size={13} color={palette.textFaint} />
                <Text style={styles.likeText}>{item.likes}</Text>
              </View>
            </View>
          ))}
        </View>

        <Pressable style={styles.registerBtn} accessibilityRole="button">
          <Feather name="plus" size={15} color={palette.blue} />
          <Text style={styles.registerText}>{t('challenges.registerCta')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: { fontSize: 24, fontWeight: '800', color: palette.text, letterSpacing: -0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  myChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.blueSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    height: 32,
  },
  myChipText: { fontSize: 12, fontWeight: '800', color: palette.blueDeep },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: palette.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
  },
  searchPh: { fontSize: 14, color: palette.textFaint },
  tabRow: { flexDirection: 'row', gap: 20, paddingHorizontal: 20, marginTop: 16 },
  tab: { paddingBottom: 8, alignItems: 'center', gap: 8 },
  tabText: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  tabTextOn: { color: palette.text },
  tabUnderline: { height: 2, width: '100%', borderRadius: 1, backgroundColor: palette.text },
  body: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 130, gap: 12 },
  previewNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.blueSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  previewText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: palette.blueDeep, lineHeight: 18 },
  sectionLabel: { fontSize: 13, fontWeight: '800', color: palette.textMuted, marginTop: 4 },
  todayCard: { backgroundColor: palette.navy, borderRadius: 18, padding: 18, gap: 12 },
  todayLine: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', lineHeight: 26 },
  todayWork: { fontSize: 12.5, fontWeight: '600', color: '#9FB0C9' },
  thumbRow: { flexDirection: 'row', gap: 8 },
  thumb: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  thumbLabel: { fontSize: 11, fontWeight: '700', color: '#C9D3DF' },
  todayStat: { fontSize: 12, fontWeight: '600', color: '#8FA5FF' },
  performBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.blue,
    borderRadius: 12,
    paddingVertical: 13,
  },
  performText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  list: { gap: 2, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rank: { width: 20, fontSize: 15, fontWeight: '900', color: palette.blue, textAlign: 'center' },
  rowBody: { flex: 1, gap: 3 },
  rowLine: { fontSize: 14.5, fontWeight: '700', color: palette.text },
  rowWork: { fontSize: 12, fontWeight: '500', color: palette.textFaint },
  likeChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  likeText: { fontSize: 12, fontWeight: '700', color: palette.textFaint },
  registerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.blueSoft,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 10,
  },
  registerText: { fontSize: 14, fontWeight: '800', color: palette.blue },
});
