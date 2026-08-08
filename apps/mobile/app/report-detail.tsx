import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

import { useAppDialog } from '@/components/app-dialog';
import { api, type ReportDetail } from '@/lib/api';
import { deletePracticeSessionIdempotently } from '@/lib/delete-practice';
import { formatKoreanDate } from '@/lib/format';
import { Markdown } from '@/components/markdown';
import { palette } from '@/constants/palette';
import { reportDisplay } from '@/lib/report-display';

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

  const onDelete = async () => {
    if (!practiceSessionId) return;
    const ok = await confirm({
      title: '삭제할까요?',
      message: '이 연습 기록을 지우면 되돌릴 수 없어요.',
      confirmLabel: '삭제',
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
        title: '삭제 실패',
        message: err instanceof Error ? err.message : '삭제하지 못했어요.',
      });
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '연습 노트' }} />
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !detail) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '연습 노트' }} />
        <View style={styles.center}>
          <Text style={styles.empty}>{error ?? '기록을 불러오지 못했어요.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { report } = detail;
  const display = reportDisplay(report);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '연습 노트', headerShadowVisible: false }} />
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{formatKoreanDate(detail.created_at)}</Text>
        <View style={styles.noteChip}>
          <Text style={styles.noteChipText}>노트</Text>
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

        <NoteSection label="영상에서 눈에 남은 곳">
          <Markdown source={display.blocked} />
          {!!display.evidence && (
            <View style={styles.quote}>
              <Markdown source={display.evidence} variant="compact" />
            </View>
          )}
        </NoteSection>

        <NoteSection label="대화에서 확인한 것">
          <Markdown source={display.found} />
        </NoteSection>

        {!!display.actorWords && (
          <NoteSection label="배우님이 남긴 문장">
            <View style={styles.quoteBlue}>
              <Markdown source={display.actorWords} />
            </View>
          </NoteSection>
        )}

        {!!display.caution && (
          <NoteSection label="연기할 때 조심할 점">
            <Markdown source={display.caution} />
          </NoteSection>
        )}

        <NoteSection label="다음 테이크 · 배우님이 고른 한 문장">
          <Text style={styles.nextTake}>{display.next}</Text>
        </NoteSection>

        <Pressable
          style={styles.deleteButton}
          onPress={() => void onDelete()}
          disabled={deleting}>
          {deleting ? (
            <ActivityIndicator color={palette.danger} />
          ) : (
            <Text style={styles.deleteText}>이 기록 삭제</Text>
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

