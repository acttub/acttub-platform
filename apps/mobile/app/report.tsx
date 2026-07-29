import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, type ActingReport } from '@/lib/api';
import { clearPractice, getPractice, setPrefill } from '@/lib/practice';
import { createOrReuseReport } from '@/lib/report-flow';
import { palette } from '@/constants/palette';
import { Markdown } from '@/components/markdown';

/**
 * A4. 피드백 카드 — 4블록 단일 초점형 (명세 §4).
 * 의도 되짚기 → 잘된 순간 → 이번에 딱 하나 → 다음 한 걸음.
 * 모든 관찰은 처방으로 닫고, 진단은 하나만 보여준다.
 */
export default function ReportScreen() {
  const router = useRouter();
  const practice = getPractice();
  const [report, setReport] = useState<ActingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const requestInFlightRef = useRef(false);

  const loadReport = useCallback(async () => {
    if (requestInFlightRef.current) return;
    if (!practice) {
      setError('진행 중인 연습이 없어요.');
      setLoading(false);
      return;
    }
    if (!practice.coachSessionId) {
      setError('코치 대화가 끝나지 않아 카드를 만들 수 없어요.');
      setLoading(false);
      return;
    }
    requestInFlightRef.current = true;
    setError(null);
    setLoading(true);
    try {
      const nextReport = await createOrReuseReport(practice, api.createReport);
      if (mountedRef.current) setReport(nextReport);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : '카드를 만들지 못했어요.');
      }
    } finally {
      requestInFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [practice]);

  useEffect(() => {
    mountedRef.current = true;
    void loadReport();
    return () => {
      mountedRef.current = false;
    };
  }, [loadReport]);

  const retake = () => {
    if (practice) setPrefill(practice.subtext);
    clearPractice();
    router.dismissAll();
    router.push('/upload');
  };

  const finish = () => {
    clearPractice();
    router.dismissAll();
  };

  const problemRange = report
    ? report.biggest_problem.end && report.biggest_problem.end !== report.biggest_problem.start
      ? `${report.biggest_problem.start} ~ ${report.biggest_problem.end}`
      : report.biggest_problem.start
    : '';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '피드백 카드', headerBackVisible: false }} />
      {!report && loading && (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} size="large" />
          <Text style={styles.loadingText}>대화를 정리해서 카드를 만들고 있어요…</Text>
        </View>
      )}
      {error && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          {practice?.coachSessionId && (
            <Pressable style={styles.nextButton} onPress={() => void loadReport()}>
              <Text style={styles.nextButtonText}>다시 시도</Text>
            </Pressable>
          )}
          <Pressable style={styles.nextButton} onPress={finish}>
            <Text style={styles.nextButtonText}>홈으로</Text>
          </Pressable>
        </View>
      )}
      {report && practice && (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.headline}>{report.headline}</Text>

          {/* 블록 0 — 의도 되짚기 */}
          <View style={styles.block}>
            <Text style={styles.blockTag}>의도 되짚기</Text>
            <Text style={styles.blockBody}>
              “{practice.subtext.subtext}” — 이걸 보여주고 싶으셨죠.
            </Text>
          </View>

          {/* 블록 1 — 잘된 순간 */}
          <View style={[styles.block, styles.blockGreen]}>
            <Text style={[styles.blockTag, styles.tagGreen]}>✓ 잘된 순간</Text>
            <Markdown source={report.encouragement} />
          </View>

          {/* 블록 2 — 이번에 딱 하나 */}
          <View style={[styles.block, styles.blockBlue]}>
            <Text style={[styles.blockTag, styles.tagBlue]}>
              이번엔 이거 딱 하나 · {problemRange}
            </Text>
            <Markdown source={report.biggest_problem.description} />
            {!!report.evidence && (
              <View style={styles.evidence}>
                <Markdown source={report.evidence} variant="compact" />
              </View>
            )}
          </View>

          {/* 대화에서 스스로 찾은 것 */}
          {!!report.self_discovery && (
            <View style={styles.block}>
              <Text style={styles.blockTag}>대화에서 스스로 찾으신 것</Text>
              <Markdown source={report.self_discovery} />
            </View>
          )}

          {/* A5 — 재촬영 비교 (이전 리포트가 있을 때만) */}
          {!!report.comparison && (
            <View style={[styles.block, styles.blockPurple]}>
              <Text style={[styles.blockTag, styles.tagPurple]}>지난번과 비교하면</Text>
              <Markdown source={report.comparison} />
            </View>
          )}

          {/* 블록 3 — 다음 한 걸음 */}
          <View style={[styles.block, styles.blockSoft]}>
            <Text style={[styles.blockTag, styles.tagBlue]}>다음 한 걸음</Text>
            <Markdown source={`→ ${report.next_step}`} />
          </View>

          <Pressable style={styles.nextButton} onPress={retake}>
            <Text style={styles.nextButtonText}>같은 장면 다시 찍기</Text>
          </Pressable>
          <Pressable onPress={finish}>
            <Text style={styles.finishLink}>오늘은 여기까지</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  loadingText: { color: palette.textDim, fontSize: 15 },
  errorText: { color: palette.danger, fontSize: 15, textAlign: 'center' },
  container: { padding: 20, paddingBottom: 40 },
  headline: {
    fontSize: 21,
    fontWeight: '800',
    color: palette.text,
    lineHeight: 30,
    marginBottom: 18,
  },
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
  blockBody: { fontSize: 15, color: palette.text, lineHeight: 23 },
  evidence: { marginTop: 8 },
  nextButton: {
    backgroundColor: palette.blue,
    borderRadius: 16,
    padding: 17,
    alignItems: 'center',
    marginTop: 14,
  },
  nextButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  finishLink: {
    color: palette.textDim,
    textAlign: 'center',
    marginTop: 16,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
