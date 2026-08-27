import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
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
import { SceneFoldBody, SceneFoldLink, SceneSummary } from '@/components/practice-chrome';
import { useExitReview } from '@/hooks/use-exit-review';
import { previewVideoSource } from '@/lib/preview-video';
import { createOrReuseReport } from '@/lib/report-flow';
import { palette } from '@/constants/palette';
import { Markdown } from '@/components/markdown';
import { reportDisplay } from '@/lib/report-display';
import { translate as t } from '@/lib/i18n';

/**
 * A4. 피드백 카드 — 4블록 단일 초점형 (명세 §4).
 * 의도 되짚기 → 잘된 순간 → 이번에 딱 하나 → 다음 한 걸음.
 * 모든 관찰은 처방으로 닫고, 진단은 하나만 보여준다.
 */
export default function ReportScreen() {
  const router = useRouter();
  const practice = getPractice();
  const exitReview = useExitReview('finish', 'report', practice?.practiceSessionId);
  const [report, setReport] = useState<PracticeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const requestInFlightRef = useRef(false);
  const params = useLocalSearchParams();
  const preview = params.preview === '1';
  const [sceneOpen, setSceneOpen] = useState(false);
  // 업로드한 원본이 남아 있으면 그걸, 없으면 서버가 준 재생 주소를 쓴다.
  const sceneVideo = practice?.videoUri || practice?.playbackUrl || previewVideoSource(preview);

  const loadReport = useCallback(async () => {
    if (requestInFlightRef.current) return;
    if (!practice) {
      setError(t('report.noPractice'));
      setLoading(false);
      return;
    }
    if (!practice.coachSessionId) {
      setError(t('report.notDone'));
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
        setError(err instanceof Error ? err.message : t('report.createFail'));
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
    // 같은 장면 프리필 + 이어받기 — 코치가 이 연습의 대화를 이어받는다 (SOMA-428).
    if (practice) {
      setPrefill({ scene: practice.scene, continuedFrom: practice.practiceSessionId });
    }
    clearPractice();
    router.dismissAll();
    router.push('/upload');
  };

  // 세션을 마칠 때 한 번만 한줄평을 묻는다(SOMA-433). 이미 물어본 사람은 바로 마친다.
  const finish = () => {
    void exitReview.offer(() => {
      clearPractice();
      router.dismissAll();
    });
  };

  const display = report && report.report_type !== 'blocked' ? reportDisplay(report) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: practice?.scene.situation.trim() || t('report.fallbackTitle'),
          headerBackVisible: false,
          headerShadowVisible: false,
        }}
      />

      {!report && loading && (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} size="large" />
          <Text style={styles.loadingText}>{t('report.making')}</Text>
        </View>
      )}

      {error && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          {practice?.coachSessionId && (
            <Pressable style={styles.primary} onPress={() => void loadReport()}>
              <Text style={styles.primaryText}>{t('common.retry')}</Text>
            </Pressable>
          )}
          <Pressable style={styles.ghost} onPress={finish}>
            <Text style={styles.ghostText}>{t('common.goHome')}</Text>
          </Pressable>
        </View>
      )}

      {report?.report_type === 'blocked' && (
        <View style={styles.center}>
          <Text style={styles.title}>{t('report.notReadyTitle')}</Text>
          <Text style={styles.loadingText}>{t('report.notReadyBody')}</Text>
          <Pressable style={styles.primary} onPress={() => router.back()}>
            <Text style={styles.primaryText}>{t('report.backToChat')}</Text>
          </Pressable>
          {/* 정리가 안 만들어졌어도 갇히지 않게 — 홈으로 가는 길을 항상 둔다(SOMA-444). */}
          <Pressable style={styles.ghost} onPress={finish}>
            <Text style={styles.ghostText}>{t('common.goHome')}</Text>
          </Pressable>
        </View>
      )}

      {report && report.report_type !== 'blocked' && display && practice && (
        <>
          <View style={styles.statusRow}>
            <Text style={styles.confirmed}>{t('report.confirmed')}</Text>
            <SceneFoldLink
              open={sceneOpen}
              onToggle={() => setSceneOpen((was) => !was)}
              label={t('blockage.sceneFold')}
            />
          </View>
          <SceneFoldBody open={sceneOpen} videoUri={sceneVideo} />
          {sceneOpen && (
            <View style={styles.sceneSummary}>
              <SceneSummary scene={practice.scene} blockage={null} />
            </View>
          )}
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.heading}>
              <Text style={styles.title}>{display.title}</Text>
              <Text style={styles.subtitle}>
                {t('report.goalQuote', { goal: practice.scene.goal })}
              </Text>
            </View>

            <Section label={t('report.secFound')}>
              <Markdown source={display.found} />
            </Section>

            <Section label={t('report.secStuck')}>
              <Markdown source={display.blocked} />
              {!!display.evidence && (
                <View style={styles.quote}>
                  <Markdown source={display.evidence} variant="compact" />
                </View>
              )}
            </Section>

            {!!display.actorWords && (
              <Section label={t('report.secLine')}>
                <View style={styles.quoteBlue}>
                  <Markdown source={display.actorWords} />
                </View>
              </Section>
            )}

            {!!display.caution && (
              <Section label={t('report.secCare')}>
                <Markdown source={display.caution} />
              </Section>
            )}

            <Section label={t('report.secNext')}>
              <Text style={styles.nextTake}>{display.next}</Text>
            </Section>

            {/* 긴 문구가 반쪽 버튼에서 줄바꿈으로 깨져서 세로로 쌓는다(SOMA-444). */}
            <View style={styles.buttonRow}>
              <Pressable style={styles.primary} onPress={retake}>
                <Text style={styles.primaryText}>{t('report.retakeCta')}</Text>
              </Pressable>
              <Pressable style={styles.ghost} onPress={finish}>
                <Text style={styles.ghostText}>{t('report.doneToday')}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </>
      )}
      {exitReview.element}
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

  sceneSummary: { paddingHorizontal: 20, paddingTop: 12 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
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

  buttonRow: { gap: 10, paddingTop: 4 },
  primary: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 14,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: 14.5, fontWeight: '900', color: palette.bg },
  ghost: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { fontSize: 14.5, fontWeight: '800', color: palette.textDim },
});
