import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  canRequest,
  evidenceLabel,
  evidenceStartSeconds,
  reportRequestFailure,
  reportRequestFailureMessage,
  reportSections,
  requestNotice,
  statusMessage,
} from '@/lib/challenge/ai-report';
import type { AiReport } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';
import { newRequestId } from '@/lib/request-id';

/**
 * 챌린지 AI 리포트(challenge.ai-report) — 같은 대사의 다른 참여작을 표본으로 둔 관찰이다.
 *
 * 점수·순위·등급을 내지 않는다(ADR-005 개정). 관찰 → 견주기 → 한계 → 다음 시도 순으로 보여 주고,
 * 관찰의 근거 구간은 그 자리부터 다시 볼 수 있다. 표본이 3개 미만이면 견주기 없이 관찰만 두고
 * "비교할 영상이 아직 부족해요"를 보인다. 본인만 보고, 비공개 참여작의 리포트도 본인은 본다.
 */
export default function AiReportScreen() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const { entryId, playbackUrl } = useLocalSearchParams<{ entryId?: string; playbackUrl?: string }>();
  const [report, setReport] = useState<AiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  const player = useVideoPlayer(typeof playbackUrl === 'string' && playbackUrl ? playbackUrl : null, (p) => {
    p.loop = false;
    p.muted = false;
  });

  const load = useCallback(async () => {
    if (!entryId) return;
    setError(null);
    try {
      setReport(await api.getAiReport(entryId));
    } catch (e) {
      const failure = reportRequestFailure(e);
      // 아직 만든 적이 없으면 404 다 — 오류가 아니라 "없음"이다.
      if (failure.kind === 'not_found') setReport(null);
      else setError(reportRequestFailureMessage(failure));
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 만드는 중이면 준비될 때까지 다시 읽는다(완료 푸시도 온다).
  useEffect(() => {
    if (report?.status !== 'pending') return;
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [load, report?.status]);

  const request = async () => {
    if (!entryId || requesting) return;
    setRequesting(true);
    setError(null);
    try {
      // 같은 시도의 재전송은 기존 작업이라 한도를 쓰지 않는다.
      requestIdRef.current = requestIdRef.current ?? newRequestId();
      await api.requestAiReport(entryId, requestIdRef.current);
      logEvent('challenge_report_requested', {});
      await load();
    } catch (e) {
      const failure = reportRequestFailure(e);
      if (failure.kind !== 'offline') requestIdRef.current = null;
      void alert({ title: t('aiReport.title'), message: reportRequestFailureMessage(failure) });
    } finally {
      setRequesting(false);
    }
  };

  const playFrom = (startMs: number) => {
    if (!playbackUrl) return;
    player.currentTime = evidenceStartSeconds({ start_ms: startMs });
    player.play();
  };

  const sections = report && report.status === 'ready' ? reportSections(report) : [];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('aiReport.title') }} />
      <ScrollView contentContainerStyle={styles.body}>
        {/* 랭킹과 다른 것이라는 사실을 머리에 둔다. */}
        <Text style={styles.notRanking}>{t('aiReport.notRanking')}</Text>

        {!!playbackUrl && <VideoView style={styles.video} player={player} contentFit="contain" nativeControls />}

        {loading && <ActivityIndicator color={palette.blue} style={{ marginTop: 24 }} />}
        {!!error && <Text style={styles.error}>{error}</Text>}

        {!loading && report === null && !error && <Text style={styles.empty}>{t('aiReport.empty')}</Text>}
        {report && report.status !== 'ready' && <Text style={styles.status}>{statusMessage(report.status)}</Text>}

        {sections.map((section) => (
          <View key={section.kind} style={styles.section}>
            <Text style={styles.label}>{section.label}</Text>

            {section.kind === 'observations' &&
              section.items.map((evidence, index) => (
                <View key={`${index}-${evidence.start_ms}`} style={styles.evidence}>
                  <Text style={styles.evidenceText}>{evidence.text}</Text>
                  <Pressable onPress={() => playFrom(evidence.start_ms)} accessibilityRole="button">
                    <Text style={styles.evidenceLink}>
                      {evidenceLabel(evidence)} · {t('aiReport.evidencePlay')}
                    </Text>
                  </Pressable>
                </View>
              ))}

            {section.kind === 'comparisons' && (
              <>
                {section.items.map((line, index) => (
                  <Text key={`${index}-${line.slice(0, 8)}`} style={styles.text}>
                    {line}
                  </Text>
                ))}
                {!!section.notice && <Text style={styles.notice}>{section.notice}</Text>}
              </>
            )}

            {section.kind === 'limits' &&
              section.items.map((line, index) => (
                <Text key={`${index}-${line.slice(0, 8)}`} style={styles.textFaint}>
                  {line}
                </Text>
              ))}

            {section.kind === 'suggestion' && (
              <Text style={styles.suggestion}>{section.text ?? t('aiReport.noSuggestion')}</Text>
            )}
          </View>
        ))}

        {canRequest(report) && (
          <View style={styles.requestBlock}>
            <Text style={styles.notice}>{requestNotice(report)}</Text>
            <Pressable
              style={[styles.primary, requesting && styles.primaryOff]}
              onPress={() => void request()}
              disabled={requesting}
              accessibilityRole="button">
              {requesting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryText}>{t(report?.status === 'failed' ? 'aiReport.retry' : 'aiReport.request')}</Text>
              )}
            </Pressable>
          </View>
        )}

        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.back}>
            <Feather name="chevron-left" size={13} color={palette.textFaint} /> {t('common.back')}
          </Text>
        </Pressable>
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { padding: 20, paddingBottom: 48, gap: 16 },
  notRanking: { fontSize: 12.5, fontWeight: '700', color: palette.blueDeep, lineHeight: 19 },
  video: { width: '100%', aspectRatio: 9 / 16, maxHeight: 320, borderRadius: 16, backgroundColor: palette.text },
  status: { fontSize: 14, fontWeight: '700', color: palette.textDim, textAlign: 'center', paddingVertical: 12 },
  error: { fontSize: 13.5, fontWeight: '700', color: palette.danger },
  empty: { fontSize: 14.5, color: palette.textDim, textAlign: 'center', paddingVertical: 24 },
  section: { borderTopWidth: 1, borderTopColor: palette.borderSoft, paddingTop: 14, gap: 8 },
  label: { fontSize: 12.5, fontWeight: '800', color: palette.textDim },
  text: { fontSize: 15, lineHeight: 24, color: palette.text },
  textFaint: { fontSize: 13.5, lineHeight: 21, color: palette.textFaint },
  suggestion: { fontSize: 16.5, fontWeight: '700', lineHeight: 26, color: palette.text },
  evidence: { gap: 4, backgroundColor: palette.bgSubtle, borderRadius: 12, padding: 14 },
  evidenceText: { fontSize: 15, lineHeight: 23, color: palette.text },
  evidenceLink: { fontSize: 12.5, fontWeight: '800', color: palette.blueDeep },
  notice: { fontSize: 12.5, color: palette.textFaint, lineHeight: 19 },
  requestBlock: { gap: 10, marginTop: 8 },
  primary: { height: 52, borderRadius: 14, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  primaryOff: { backgroundColor: '#C9D3DF' },
  primaryText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  back: { fontSize: 13, fontWeight: '700', color: palette.textFaint, textAlign: 'center', paddingVertical: 12 },
});
