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

import { api, type PracticeReport } from '@/lib/api';
import { clearPractice, getPractice, setPrefill } from '@/lib/practice';
import { createOrReuseReport } from '@/lib/report-flow';
import { palette } from '@/constants/palette';
import { Markdown } from '@/components/markdown';
import { reportDisplay } from '@/lib/report-display';

/**
 * A4. 피드백 카드 — 4블록 단일 초점형 (명세 §4).
 * 의도 되짚기 → 잘된 순간 → 이번에 딱 하나 → 다음 한 걸음.
 * 모든 관찰은 처방으로 닫고, 진단은 하나만 보여준다.
 */
export default function ReportScreen() {
  const router = useRouter();
  const practice = getPractice();
  const [report, setReport] = useState<PracticeReport | null>(null);
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
    if (practice) setPrefill(practice.scene);
    clearPractice();
    router.dismissAll();
    router.push('/upload');
  };

  const finish = () => {
    clearPractice();
    router.dismissAll();
  };

  const display = report && report.report_type !== 'blocked' ? reportDisplay(report) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: practice?.scene.situation.trim() || '분석 결과',
          headerBackVisible: false,
          headerShadowVisible: false,
        }}
      />

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
            <Pressable style={styles.primary} onPress={() => void loadReport()}>
              <Text style={styles.primaryText}>다시 시도</Text>
            </Pressable>
          )}
          <Pressable style={styles.ghost} onPress={finish}>
            <Text style={styles.ghostText}>홈으로</Text>
          </Pressable>
        </View>
      )}

      {report?.report_type === 'blocked' && (
        <View style={styles.center}>
          <Text style={styles.title}>아직 정리가 만들어지지 않았어요</Text>
          <Text style={styles.loadingText}>
            대화가 조금 더 이어지면 오늘 정리를 볼 수 있어요.
          </Text>
          <Pressable style={styles.primary} onPress={() => router.back()}>
            <Text style={styles.primaryText}>대화로 돌아가기</Text>
          </Pressable>
        </View>
      )}

      {report && report.report_type !== 'blocked' && display && practice && (
        <>
          <View style={styles.statusRow}>
            <Text style={styles.confirmed}>✓ 배우님과 맞춘 내용</Text>
          </View>
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.heading}>
              <Text style={styles.title}>{display.title}</Text>
              <Text style={styles.subtitle}>
                “{practice.scene.goal}” — 이걸 하려던 장면이었어요.
              </Text>
            </View>

            <Section label="대화에서 찾은 것">
              <Markdown source={display.found} />
            </Section>

            <Section label="지금 막힌 곳">
              <Markdown source={display.blocked} />
              {!!display.evidence && (
                <View style={styles.quote}>
                  <Markdown source={display.evidence} variant="compact" />
                </View>
              )}
            </Section>

            {!!display.actorWords && (
              <Section label="배우님이 남긴 문장">
                <View style={styles.quoteBlue}>
                  <Markdown source={display.actorWords} />
                </View>
              </Section>
            )}

            {!!display.caution && (
              <Section label="연기할 때 조심할 점">
                <Markdown source={display.caution} />
              </Section>
            )}

            <Section label="다음 테이크 · 배우님이 고른 한 문장">
              <Text style={styles.nextTake}>{display.next}</Text>
            </Section>

            <View style={styles.buttonRow}>
              <Pressable style={styles.ghost} onPress={finish}>
                <Text style={styles.ghostText}>오늘은 여기까지</Text>
              </Pressable>
              <Pressable style={styles.primary} onPress={retake}>
                <Text style={styles.primaryText}>같은 장면 다시 찍기 →</Text>
              </Pressable>
            </View>
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

/** 목업의 섹션 — 위에 얇은 선, 작은 라벨, 그 아래 내용. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 14 },
  loadingText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: palette.textFaint,
    textAlign: 'center',
    lineHeight: 22,
  },
  errorText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: palette.danger,
    textAlign: 'center',
    lineHeight: 22,
  },

  statusRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  confirmed: { fontSize: 12.5, fontWeight: '700', color: palette.green },

  body: { paddingTop: 22, paddingHorizontal: 20, paddingBottom: 24, gap: 20 },
  heading: { gap: 6 },
  title: { fontSize: 23, fontWeight: '900', color: palette.text, lineHeight: 32 },
  subtitle: { fontSize: 13.5, fontWeight: '600', color: palette.textDim, lineHeight: 22 },

  section: {
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    paddingTop: 16,
    gap: 10,
  },
  sectionLabel: { fontSize: 11.5, fontWeight: '900', color: palette.textFaint },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: palette.border,
    paddingLeft: 14,
    paddingVertical: 2,
  },
  quoteBlue: {
    borderLeftWidth: 2,
    borderLeftColor: palette.blue,
    paddingLeft: 14,
    paddingVertical: 2,
  },
  nextTake: { fontSize: 17, fontWeight: '900', color: palette.text, lineHeight: 27 },

  buttonRow: { flexDirection: 'row', gap: 10, paddingTop: 4 },
  primary: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: 14.5, fontWeight: '900', color: palette.bg },
  ghost: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { fontSize: 14.5, fontWeight: '800', color: palette.textDim },
});
