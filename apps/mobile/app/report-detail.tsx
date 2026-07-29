import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

import { api, type ReportDetail } from '@/lib/api';
import { deletePracticeSessionIdempotently } from '@/lib/delete-practice';
import { formatKoreanDate } from '@/lib/format';
import { Markdown } from '@/components/markdown';
import { palette } from '@/constants/palette';

/**
 * 지난 피드백 상세 — 기록 화면에서 카드를 누르면 열린다.
 * practice_session_id를 라우터 파라미터로 받아 GET /v2/reports/{id}로
 * 리포트 본문과 영상 재생 URL을 조회한다.
 */
export default function ReportDetailScreen() {
  const router = useRouter();
  const { practiceSessionId } = useLocalSearchParams<{ practiceSessionId: string }>();
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    let cancelled = false;
    if (!practiceSessionId) {
      setError('기록을 불러오지 못했어요.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .getReport(practiceSessionId)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        if (result.playback_url) player.replace(result.playback_url);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '기록을 불러오지 못했어요.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceSessionId, player]);

  const onDelete = () => {
    if (!practiceSessionId) return;
    Alert.alert('삭제할까요?', '이 연습 기록을 지우면 되돌릴 수 없어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deletePracticeSessionIdempotently(
              practiceSessionId,
              api.deletePracticeSession,
            );
            router.back();
          } catch (err) {
            setDeleting(false);
            Alert.alert('삭제 실패', err instanceof Error ? err.message : '삭제하지 못했어요.');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '피드백 카드' }} />
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !detail) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '피드백 카드' }} />
        <View style={styles.center}>
          <Text style={styles.empty}>{error ?? '기록을 불러오지 못했어요.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { report } = detail;
  const problem = report.biggest_problem;
  const problemRange = problem
    ? problem.end && problem.end !== problem.start
      ? `${problem.start} ~ ${problem.end}`
      : problem.start
    : '';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '피드백 카드' }} />
      <ScrollView contentContainerStyle={styles.container}>
        {!!detail.playback_url && (
          <VideoView
            style={styles.video}
            player={player}
            nativeControls
            allowsFullscreen
            contentFit="contain"
          />
        )}
        <Text style={styles.date}>{formatKoreanDate(detail.created_at)}</Text>
        <Text style={styles.headline}>{report.headline}</Text>

        <View style={[styles.block, styles.blockGreen]}>
          <Text style={[styles.blockTag, styles.tagGreen]}>✓ 잘된 순간</Text>
          <Markdown source={report.encouragement} />
        </View>

        <View style={[styles.block, styles.blockBlue]}>
          <Text style={[styles.blockTag, styles.tagBlue]}>이번엔 이거 딱 하나 · {problemRange}</Text>
          <Markdown source={problem?.description ?? ''} />
          {!!report.evidence && (
            <View style={styles.evidence}>
              <Markdown source={report.evidence} variant="compact" />
            </View>
          )}
        </View>

        {!!report.self_discovery && (
          <View style={styles.block}>
            <Text style={styles.blockTag}>대화에서 스스로 찾으신 것</Text>
            <Markdown source={report.self_discovery} />
          </View>
        )}

        {!!report.comparison && (
          <View style={[styles.block, styles.blockPurple]}>
            <Text style={[styles.blockTag, styles.tagPurple]}>지난번과 비교하면</Text>
            <Markdown source={report.comparison} />
          </View>
        )}

        <View style={[styles.block, styles.blockSoft]}>
          <Text style={[styles.blockTag, styles.tagBlue]}>다음 한 걸음</Text>
          <Markdown source={`→ ${report.next_step}`} />
        </View>

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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  empty: { color: palette.textDim, fontSize: 15 },
  container: { padding: 20, paddingBottom: 40 },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 16,
    backgroundColor: '#000',
    marginBottom: 16,
  },
  date: { color: palette.textFaint, fontSize: 13, marginBottom: 8 },
  headline: { fontSize: 21, fontWeight: '800', color: palette.text, lineHeight: 30, marginBottom: 18 },
  block: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  blockGreen: { backgroundColor: palette.greenSoft, borderColor: palette.greenSoft },
  blockBlue: { borderColor: palette.blue, borderWidth: 1.5 },
  blockPurple: { backgroundColor: palette.purpleSoft, borderColor: palette.purpleSoft },
  blockSoft: { backgroundColor: palette.blueSoft, borderColor: palette.blueSoft },
  blockTag: { fontSize: 12, fontWeight: '800', color: palette.textDim, marginBottom: 6 },
  tagGreen: { color: palette.green },
  tagBlue: { color: palette.blue },
  tagPurple: { color: palette.purple },
  evidence: { marginTop: 8 },
  deleteButton: {
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.danger,
    alignItems: 'center',
  },
  deleteText: { color: palette.danger, fontSize: 15, fontWeight: '700' },
});
