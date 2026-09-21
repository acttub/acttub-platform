import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

import { useAppDialog } from '@/components/app-dialog';
import { api, type ReportDetail } from '@/lib/api';
import { deletePracticeSessionIdempotently } from '@/lib/delete-practice';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { formatKoreanDate } from '@/lib/format';
import { Markdown } from '@/components/markdown';
import { palette } from '@/constants/palette';
import { PracticeNoteBody } from '@/components/practice-note';
import { reportDisplay } from '@/lib/report-display';
import { translate as t } from '@/lib/i18n';

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
  const { confirm, alert, dialog } = useAppDialog();

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    let cancelled = false;
    if (!practiceSessionId) {
      setError(t('reportDetail.loadFail'));
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
        setError(err instanceof Error ? err.message : t('reportDetail.loadFail'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceSessionId, player]);

  /** 같은 묶음의 다음 회차로 간다. 그 회차의 영상을 그대로 쓴다. */
  const continuePractice = async () => {
    const loaded = await api.getPractice(practiceSessionId).catch(() => null);
    setContinueOrigin(
      loaded
        ? { kind: 'history', rootId: loaded.root_id, practiceId: loaded.id, videoId: loaded.video_id }
        : { kind: 'group', rootId: practiceSessionId, practiceId: practiceSessionId },
    );
    router.push('/upload');
  };

  const onDelete = async () => {
    if (!practiceSessionId) return;
    const ok = await confirm({
      title: t('reportDetail.deleteTitle'),
      message: t('reportDetail.deleteMsg'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deletePracticeSessionIdempotently(practiceSessionId, api.deletePracticeSession);
      router.back();
    } catch (err) {
      setDeleting(false);
      await alert({
        title: t('reportDetail.deleteFailTitle'),
        message: err instanceof Error ? err.message : t('reportDetail.deleteFail'),
      });
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: t('reportDetail.screenTitle') }} />
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !detail) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: t('reportDetail.screenTitle') }} />
        <View style={styles.center}>
          <Text style={styles.empty}>{error ?? t('reportDetail.loadFail')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { report } = detail;
  const display = reportDisplay(report);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('reportDetail.screenTitle'), headerShadowVisible: false }} />
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{formatKoreanDate(detail.created_at)}</Text>
        <View style={styles.noteChip}>
          <Text style={styles.noteChipText}>{t('reportDetail.noteChip')}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{display.title}</Text>

        {!!detail.playback_url && (
          <VideoView
            style={styles.video}
            player={player}
            nativeControls
            allowsFullscreen
            contentFit="contain"
          />
        )}

        {report.report_type === 'practice_note' ? <PracticeNoteBody note={report} /> : <>
        <NoteSection label={t('reportDetail.secEye')}>
          <Markdown source={display.blocked} />
          {!!display.evidence && (
            <View style={styles.quote}>
              <Markdown source={display.evidence} variant="compact" />
            </View>
          )}
        </NoteSection>

        <NoteSection label={t('reportDetail.secConfirmed')}>
          <Markdown source={display.found} />
        </NoteSection>

        {!!display.actorWords && (
          <NoteSection label={t('reportDetail.secLine')}>
            <View style={styles.quoteBlue}>
              <Markdown source={display.actorWords} />
            </View>
          </NoteSection>
        )}

        {!!display.caution && (
          <NoteSection label={t('reportDetail.secCare')}>
            <Markdown source={display.caution} />
          </NoteSection>
        )}

        <NoteSection label={t('reportDetail.secNext')}>
          <Text style={styles.nextTake}>{display.next}</Text>
        </NoteSection>

        </>}

        {/* A1.2 이어서 연습하기 — 같은 영상으로 같은 묶음의 다음 회차를 만든다. 지난 기록에서
            이어갈 때는 장면을 미리 채우지 않는다(practice.resume). 영상 id 를 읽지 못하면
            영상을 새로 고르는 흐름으로 보낸다. */}
        <Pressable
          style={styles.continueButton}
          onPress={() => void continuePractice()}>
          <Text style={styles.continueText}>{t('reportDetail.continueCta')}</Text>
        </Pressable>

        <Pressable
          style={styles.deleteButton}
          onPress={() => void onDelete()}
          disabled={deleting}>
          {deleting ? (
            <ActivityIndicator color={palette.danger} />
          ) : (
            <Text style={styles.deleteText}>{t('reportDetail.deleteThis')}</Text>
          )}
        </Pressable>
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

/** 목업의 노트 섹션 — 위 얇은 선, 작은 라벨, 내용. */
function NoteSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  empty: { color: palette.textDim, fontSize: 15 },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  metaText: { fontSize: 12.5, fontWeight: '700', color: palette.textDim },
  noteChip: {
    backgroundColor: palette.blueSoft,
    borderRadius: 9999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  noteChipText: { fontSize: 11.5, fontWeight: '800', color: palette.blueDeep },

  body: { paddingTop: 22, paddingHorizontal: 20, paddingBottom: 32, gap: 22 },
  title: { fontSize: 24, fontWeight: '900', color: palette.text, lineHeight: 34 },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    backgroundColor: palette.bgSoft,
  },

  section: {
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    paddingTop: 16,
    gap: 8,
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

  continueButton: {
    marginTop: 20,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: palette.blue,
  },
  continueText: { fontSize: 14.5, fontWeight: '800', color: '#fff' },
  deleteButton: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  deleteText: { fontSize: 13.5, fontWeight: '800', color: palette.danger },
});

