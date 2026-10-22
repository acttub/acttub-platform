import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { PrimaryButton } from '@/components/ui/buttons';
import { IconOptionRow } from '@/components/ui/option-card';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  canRequest,
  evidenceLabel,
  reportRequestFailure,
  reportRequestFailureMessage,
  reportSections,
  requestNotice,
  statusMessage,
} from '@/lib/challenge/ai-report';
import { entryShareUrl } from '@/lib/challenge/deeplink';
import { entryFailure, entryFailureMessage } from '@/lib/challenge/entry';
import { hasFinishedFirstChallenge } from '@/lib/challenge/intro-state';
import type { AiReport, EntryVisibility } from '@/lib/challenge/types';
import { localCopyFor } from '@/lib/library/library-runner';
import { setPickedVideo } from '@/lib/practice/picked-video';
import { translate as t } from '@/lib/i18n';
import { newRequestId } from '@/lib/request-id';

/**
 * 챌린지 AI 리포트(challenge.ai-report) — 같은 대사의 다른 참여작을 표본으로 둔 관찰이다.
 *
 * 점수·순위·등급을 내지 않는다(ADR-005 개정). 관찰 → 견주기 → 한계 → 다음 시도 순으로 보여 주고,
 * 관찰에는 근거 구간의 시각을 단다. 표본이 3개 미만이면 견주기 없이 관찰만 두고
 * "비교할 영상이 아직 부족해요"를 보인다. 본인만 보고, 비공개 참여작의 리포트도 본인은 본다.
 *
 * SOMA-748(8UOkFq): 올리기 흐름에서 왔으면(challengeId 가 있으면) 아래에 「이제 뭐 할까요?」 다음 행동을 둔다 —
 * 코칭으로 더 보기(같은 영상으로 새 연습, 영상 id 가 있을 때만) · 공개하기(나만 보기일 때, 확인창 뒤 공개로) ·
 * 공유하기(공개일 때, 참여작 링크) · 여기까지 할게요(챌린지 마무리). 알림·프로필 기록에서 열면 리포트만 보인다.
 */
export default function AiReportScreen() {
  const router = useRouter();
  const { alert, confirm, sheet, dialog } = useAppDialog();
  const params = useLocalSearchParams<{ entryId?: string; videoId?: string; challengeId?: string; visibility?: string; request?: string }>();
  const { entryId } = params;
  const challengeId = params.challengeId || null;
  const videoId = params.videoId || null;
  const [visibility, setVisibility] = useState<EntryVisibility | null>(
    params.visibility === 'public' || params.visibility === 'private' ? params.visibility : null,
  );
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [report, setReport] = useState<AiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  /** 올리기 완료의 「AI 리포트 보기」로 왔으면(request=1) 아직 없는 리포트를 한 번만 바로 부탁한다(SOMA-773). */
  const autoRequestRef = useRef(params.request === '1');

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

  // 처음 읽은 결과가 「없음」일 때만 — 실패한 리포트의 다시 시도는 하루 한도를 쓰니 배우가 직접 누른다.
  useEffect(() => {
    if (loading || error || !autoRequestRef.current) return;
    autoRequestRef.current = false;
    if (report === null) void request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, report]);

  useEffect(() => {
    void hasFinishedFirstChallenge().then((done) => setShowGuide(!done));
  }, []);

  /** 같은 영상으로 새 연습을 연다 — 보관함 「질문 코칭으로 보내기」와 같은 길(picked-video → upload). */
  const toCoach = async () => {
    if (!videoId) return;
    void logEvent('challenge_report_to_coach', {});
    const uri = await localCopyFor(videoId).catch(() => null);
    setPickedVideo({ videoId, pendingId: null, uri: uri ?? null, playbackUrl: null, durationMs: null });
    router.push('/upload');
  };

  const finish = () => {
    if (!challengeId) return;
    void logEvent('challenge_report_finish', {});
    router.replace({ pathname: '/challenge-finish', params: { challengeId, entryId: entryId ?? '' } });
  };

  /** 나만 보기 참여작을 공개로 바꾼다(Avv5P0 확인창). 바꾸면 마무리로 간다. */
  const makePublic = async () => {
    if (!entryId || busy) return;
    const ok = await confirm({
      title: t('aiReport.publicTitle'),
      message: t('aiReport.publicBody'),
      confirmLabel: t('aiReport.publicConfirm'),
    });
    if (!ok) return;
    // 공개하면서 얼굴 모자이크를 켤지 고른다(SOMA-809). 창을 닫거나 취소하면 공개하지 않는다.
    let mosaic: boolean | null = null;
    await sheet({
      title: t('challengeEntries.mosaicAskTitle'),
      actions: [
        { label: t('challengeEntries.mosaicAskConfirm'), onPress: () => { mosaic = true; } },
        { label: t('challengeEntries.mosaicAskSkip'), onPress: () => { mosaic = false; } },
      ],
    });
    if (mosaic === null) return;
    setBusy(true);
    try {
      await api.updateEntry(entryId, mosaic ? { visibility: 'public', face_mosaic: true } : { visibility: 'public' });
      void logEvent('challenge_entry_visibility', { to: 'public' });
      setVisibility('public');
      finish();
    } catch (e) {
      void alert({ title: t('aiReport.publicTitle'), message: entryFailureMessage(entryFailure(e)) });
    } finally {
      setBusy(false);
    }
  };

  const share = () => {
    if (!entryId) return;
    void logEvent('challenge_share', { id: entryId });
    void Share.share({ message: entryShareUrl(entryId), url: entryShareUrl(entryId) }).catch(() => {});
  };

  const sections = report && report.status === 'ready' ? reportSections(report) : [];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('aiReport.title') }} />
      <ScrollView contentContainerStyle={styles.body}>
        {/* 랭킹과 다른 것이라는 사실을 머리에 둔다. */}
        <Text style={styles.notRanking}>{t('aiReport.notRanking')}</Text>

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
                  <Text style={styles.evidenceTime}>{evidenceLabel(evidence)}</Text>
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
            <PrimaryButton
              label={t(report?.status === 'failed' ? 'aiReport.retry' : 'aiReport.request')}
              onPress={() => void request()}
              loading={requesting}
            />
          </View>
        )}

        {challengeId ? (
          <View style={styles.next}>
            <Text style={styles.nextTitle}>{t('aiReport.nextTitle')}</Text>
            {showGuide && !!videoId && <Text style={styles.guide}>{t('aiReport.nextGuide')}</Text>}
            {!!videoId && (
              <IconOptionRow flush icon="message-circle" title={t('aiReport.nextCoach')} sub={t('aiReport.nextCoachSub')} highlight onPress={() => void toCoach()} />
            )}
            {visibility === 'private' && (
              <IconOptionRow flush icon="globe" title={t('aiReport.nextPublic')} sub={t('aiReport.nextPublicSub')} onPress={() => void makePublic()} />
            )}
            {visibility === 'public' && (
              <IconOptionRow flush icon="share-2" title={t('aiReport.nextShare')} sub={t('aiReport.nextShareSub')} onPress={share} />
            )}
            <IconOptionRow flush icon="check" title={t('aiReport.nextDone')} sub={t('aiReport.nextDoneSub')} onPress={finish} />
          </View>
        ) : (
          <Pressable onPress={() => router.back()} accessibilityRole="button" ph-label="ai_report_back">
            <Text style={styles.back}>
              <Feather name="chevron-left" size={13} color={palette.textFaint} /> {t('common.back')}
            </Text>
          </Pressable>
        )}
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  pressed: { opacity: 0.85 },
  body: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48, gap: 14 },
  notRanking: { fontSize: 13, fontWeight: '700', color: palette.blue, lineHeight: 19 },
  status: { fontSize: 14, fontWeight: '700', color: palette.textDim, textAlign: 'center', paddingVertical: 12 },
  error: { fontSize: 13.5, fontWeight: '700', color: palette.danger },
  empty: { fontSize: 14.5, color: palette.textDim, textAlign: 'center', paddingVertical: 24 },
  section: { paddingVertical: 6, gap: 10 },
  label: { fontSize: 13, fontWeight: '800', color: palette.textDim },
  text: { fontSize: 15, fontWeight: '600', lineHeight: 23, color: palette.text },
  textFaint: { fontSize: 13.5, lineHeight: 21, color: palette.textFaint },
  suggestion: { fontSize: 16, fontWeight: '700', lineHeight: 25, color: palette.text },
  evidence: { gap: 4 },
  evidenceText: { fontSize: 15, fontWeight: '600', lineHeight: 23, color: palette.text },
  evidenceTime: { fontSize: 12.5, fontWeight: '800', color: palette.blueDeep },
  notice: { fontSize: 12.5, color: palette.textFaint, lineHeight: 19 },
  requestBlock: { gap: 10, marginTop: 8 },
  back: { fontSize: 13, fontWeight: '700', color: palette.textFaint, textAlign: 'center', paddingVertical: 12 },
  next: { gap: 6, marginTop: 8 },
  nextTitle: { fontSize: 15, fontWeight: '800', color: palette.text, marginBottom: 6 },
  guide: { fontSize: 14, fontWeight: '700', color: palette.blueDeep, lineHeight: 21, marginBottom: 6 },
});
