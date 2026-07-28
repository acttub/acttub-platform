import { Stack, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, type ReportDetailResponse } from '@/lib/api';
import { getSelectedReport } from '@/lib/selected-report';
import { formatKoreanDate } from '@/lib/format';
import { palette } from '@/constants/palette';

/**
 * 지난 피드백 상세 — 기록 카드를 누르면 열린다.
 * 목록(GET /v2/reports)은 headline 요약만 주므로, 전문은
 * GET /v2/reports/{practice_session_id}로 따로 불러온다.
 */
export default function ReportDetailScreen() {
  const router = useRouter();
  const record = getSelectedReport();
  const [detail, setDetail] = useState<ReportDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!record) return;
    let cancelled = false;
    api
      .reportDetail(record.practice_session_id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '리포트를 불러오지 못했어요.');
      });
    return () => {
      cancelled = true;
    };
  }, [record]);

  // 연습 영상 재생 (상세 응답의 playback_url). 없으면 null → 플레이어 비활성.
  const player = useVideoPlayer(detail?.playback_url ?? null, (p) => {
    p.loop = false;
  });

  const onDelete = () => {
    if (!record) return;
    Alert.alert('삭제할까요?', '이 연습 기록을 지우면 되돌릴 수 없어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await api.deletePracticeSession(record.practice_session_id);
            router.back();
          } catch (err) {
            setDeleting(false);
            Alert.alert('삭제 실패', err instanceof Error ? err.message : '삭제하지 못했어요.');
          }
        },
      },
    ]);
  };

  if (!record) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '피드백 카드' }} />
        <View style={styles.center}>
          <Text style={styles.empty}>기록을 불러오지 못했어요.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const report = detail?.report;
  const problem = report?.biggest_problem;
  const problemRange = problem
    ? problem.end && problem.end !== problem.start
      ? `${problem.start} ~ ${problem.end}`
      : problem.start
    : '';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '피드백 카드' }} />
      <ScrollView contentContainerStyle={styles.container}>
        {!!detail?.playback_url && (
          <View style={styles.videoWrap}>
            <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />
          </View>
        )}

        <Text style={styles.date}>{formatKoreanDate(record.created_at)}</Text>
        <Text style={styles.headline}>{report?.headline ?? record.headline}</Text>

        {!report && !error && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={palette.blue} />
            <Text style={styles.loadingText}>리포트를 불러오는 중…</Text>
          </View>
        )}
        {!!error && <Text style={styles.errorText}>{error}</Text>}

        {!!report && (
          <>
            {/* 잘된 순간 */}
            <View style={[styles.card, styles.cardGreen]}>
              <Text style={[styles.eyebrow, styles.eyebrowGreen]}>잘된 순간</Text>
              <Text style={styles.body}>{report.encouragement}</Text>
            </View>

            {/* 이번엔 이거 딱 하나 */}
            <View style={[styles.card, styles.cardBlue]}>
              <Text style={[styles.eyebrow, styles.eyebrowBlue]}>이번엔 이거 딱 하나</Text>
              {!!problem && (
                <View style={styles.pill}>
                  <View style={styles.pillDot} />
                  <Text style={styles.pillText}>
                    {problemRange}
                    {problem.dimension ? ` · ${problem.dimension}` : ''}
                  </Text>
                </View>
              )}
              <Text style={styles.body}>{problem?.description ?? ''}</Text>
              {!!report.evidence && <Text style={styles.evidence}>{report.evidence}</Text>}
            </View>

            {/* 대화에서 스스로 찾은 것 */}
            {!!report.self_discovery && (
              <View style={styles.card}>
                <Text style={styles.eyebrow}>대화에서 스스로 찾으신 것</Text>
                <Text style={styles.body}>{report.self_discovery}</Text>
              </View>
            )}

            {/* 지난번과 비교 */}
            {!!report.comparison && (
              <View style={[styles.card, styles.cardPurple]}>
                <Text style={[styles.eyebrow, styles.eyebrowPurple]}>지난번과 비교하면</Text>
                <Text style={styles.body}>{report.comparison}</Text>
              </View>
            )}

            {/* 다음 한 걸음 */}
            <View style={[styles.card, styles.cardNext]}>
              <Text style={styles.eyebrowOnDark}>다음 한 걸음</Text>
              <Text style={styles.bodyOnDark}>{report.next_step}</Text>
            </View>
          </>
        )}

        <Pressable style={styles.deleteButton} onPress={onDelete} disabled={deleting}>
          {deleting ? (
            <ActivityIndicator color={palette.danger} />
          ) : (
            <Text style={styles.deleteText}>이 기록 삭제</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const CARD_SHADOW = {
  // shadow*는 iOS 전용(원래 값 유지), elevation은 Android 전용(진해서 낮춤)
  shadowColor: '#191F28',
  shadowOpacity: 0.06,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 10 },
  elevation: 1,
} as const;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bgSoft },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  empty: { color: palette.textDim, fontSize: 15 },
  loadingBox: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  loadingText: { color: palette.textDim, fontSize: 14 },
  errorText: { color: palette.danger, fontSize: 14, paddingVertical: 20, textAlign: 'center' },
  container: { padding: 20, paddingBottom: 48 },

  videoWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginBottom: 16,
    ...CARD_SHADOW,
  },
  video: { width: '100%', height: '100%' },

  date: { color: palette.textFaint, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  headline: { fontSize: 24, fontWeight: '800', color: palette.text, lineHeight: 33, letterSpacing: -0.5, marginBottom: 20 },

  card: {
    backgroundColor: palette.card,
    borderRadius: 22,
    padding: 18,
    marginBottom: 12,
    ...CARD_SHADOW,
  },
  cardGreen: { backgroundColor: palette.greenSoft },
  cardBlue: { backgroundColor: palette.blueSoft },
  cardPurple: { backgroundColor: palette.purpleSoft },
  cardNext: { backgroundColor: palette.navy },

  eyebrow: { fontSize: 12, fontWeight: '800', color: palette.textDim, letterSpacing: 0.2, marginBottom: 8 },
  eyebrowGreen: { color: palette.green },
  eyebrowBlue: { color: palette.blue },
  eyebrowPurple: { color: palette.purple },
  eyebrowOnDark: { fontSize: 12, fontWeight: '800', color: '#8FA5FF', letterSpacing: 0.2, marginBottom: 8 },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 10,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.blue },
  pillText: { fontSize: 13, fontWeight: '800', color: palette.textDim },

  body: { fontSize: 15, color: palette.text, lineHeight: 24 },
  bodyOnDark: { fontSize: 16, color: '#FFFFFF', lineHeight: 25, fontWeight: '600' },
  evidence: { fontSize: 13, color: palette.textDim, lineHeight: 20, marginTop: 10 },

  deleteButton: {
    marginTop: 20,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  deleteText: { color: palette.danger, fontSize: 15, fontWeight: '700' },
});
