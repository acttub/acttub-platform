import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { PERFORMERS, PERF_IMAGES, TODAY_LINE } from '@/lib/challenge-mock';
import { translate as t } from '@/lib/i18n';

/**
 * A17 대사 상세 — 한 대사에 올라온 연기 영상을 좋아요순/최신순으로 겨루는 랭킹.
 *
 * 예시(목업) 데이터로 채운다. 재생·좋아요·공유는 아직 백엔드가 없어 안내만 한다.
 * "이 대사로 연기하기"는 실제 연습 시작(/upload)으로 이어진다.
 */
export default function ChallengeDetailScreen() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const params = useLocalSearchParams<{ line?: string; work?: string }>();
  const [tab, setTab] = useState(0);
  const line = params.line || TODAY_LINE.line;
  const work = params.work || TODAY_LINE.work;

  const soon = (where: string) => {
    logEvent('challenge_soon_tap', { where });
    void alert({
      title: t('challenges.soonTitle'),
      message: t('challenges.soonMessage'),
      confirmLabel: t('common.confirm'),
    });
  };
  const perform = () => {
    logEvent('challenge_perform_tap', { line: line.slice(0, 40) });
    router.push('/upload');
  };
  // 최신순 탭은 예시라 순서만 뒤집어 다르게 보이게 한다.
  const list = tab === 0 ? PERFORMERS : [...PERFORMERS].reverse();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('challenges.detailTitle'),
          headerRight: () => (
            <Pressable onPress={() => soon('share')} accessibilityRole="button" hitSlop={8}>
              <Feather name="share-2" size={20} color={palette.textDim} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {/* 대사 카드 */}
        <View style={styles.lineCard}>
          <Text style={styles.lineLabel}>{t('challenges.todayLabel')}</Text>
          <Text style={styles.line}>“{line}”</Text>
          <Text style={styles.work}>{work}</Text>
          <Text style={styles.stat}>
            {t('challenges.statLine', { plays: TODAY_LINE.plays, likes: TODAY_LINE.likes })}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.performBtn, pressed && styles.pressed]}
            onPress={perform}
            accessibilityRole="button">
            <Feather name="play" size={15} color="#FFFFFF" />
            <Text style={styles.performText}>{t('challenges.performCta2')}</Text>
          </Pressable>
        </View>

        <Text style={styles.performersLabel}>{t('challenges.performers', { count: PERFORMERS.length })}</Text>

        {/* 좋아요순 / 최신순 */}
        <View style={styles.tabRow}>
          {[t('challenges.tabLikes'), t('challenges.tabRecent')].map((label, i) => (
            <Pressable key={label} style={styles.tab} onPress={() => setTab(i)}>
              <Text style={[styles.tabText, tab === i && styles.tabTextOn]}>{label}</Text>
              {tab === i && <View style={styles.tabUnderline} />}
            </Pressable>
          ))}
        </View>

        {/* 연기 영상 랭킹 */}
        <View style={styles.list}>
          {list.map((p, i) => (
            <Pressable
              key={p.name}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() =>
                router.push({ pathname: '/challenge-play', params: { name: p.name, line } })
              }
              accessibilityRole="button">
              {tab === 0 && <Text style={[styles.rank, i < 3 && styles.rankTop]}>{i + 1}</Text>}
              <View style={styles.thumbWrap}>
                <Image source={PERF_IMAGES[p.img]} style={styles.thumb} resizeMode="cover" />
                <View style={styles.playOverlay}>
                  <Feather name="play" size={16} color="#FFFFFF" />
                </View>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowName}>{p.name}</Text>
                <View style={styles.likeRow}>
                  <Feather name="heart" size={12} color={palette.textFaint} />
                  <Text style={styles.likeText}>{p.likes}</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  pressed: { opacity: 0.8 },
  content: { padding: 20, paddingBottom: 40, gap: 14 },

  lineCard: { backgroundColor: palette.navy, borderRadius: 18, padding: 18, gap: 10 },
  lineLabel: { fontSize: 12, fontWeight: '700', color: '#8FA5FF' },
  line: { fontSize: 19, fontWeight: '800', color: '#FFFFFF', lineHeight: 27 },
  work: { fontSize: 12.5, fontWeight: '600', color: '#9FB0C9' },
  stat: { fontSize: 12, fontWeight: '600', color: '#8FA5FF' },
  performBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.blue,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 2,
  },
  performText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },

  performersLabel: { fontSize: 13, fontWeight: '800', color: palette.textMuted, marginTop: 4 },
  tabRow: { flexDirection: 'row', gap: 20 },
  tab: { paddingBottom: 8, alignItems: 'center', gap: 8 },
  tabText: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  tabTextOn: { color: palette.text },
  tabUnderline: { height: 2, width: '100%', borderRadius: 1, backgroundColor: palette.text },

  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
  },
  rank: { width: 18, fontSize: 15, fontWeight: '900', color: palette.textFaint, textAlign: 'center' },
  rankTop: { color: palette.blue },
  thumbWrap: { width: 52, height: 68, borderRadius: 10, overflow: 'hidden', backgroundColor: palette.bgSoft },
  thumb: { width: '100%', height: '100%' },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  rowBody: { flex: 1, gap: 5 },
  rowName: { fontSize: 15, fontWeight: '700', color: palette.text },
  likeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  likeText: { fontSize: 12, fontWeight: '700', color: palette.textFaint },
});
