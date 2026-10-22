import { Fragment, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';

import { palette } from '@/constants/palette';
import { useVideoPreviewEvents } from '@/hooks/use-video-preview-events';
import { logEvent } from '@/lib/analytics';
import type { SceneContext } from '@/lib/api';
import { translate as t, translateList } from '@/lib/i18n';
import { summaryRows } from '@/lib/practice/scene-summary';
import { limitVideoBuffer } from '@/lib/video-memory';
import { FOLD_OPEN_EVENT, type PreviewScreen } from '@/lib/video-preview-events';

/**
 * 연습 흐름(막히는 지점 → 분석 → 질문 대화)의 화면들이 공유하는 머리 부분.
 *
 * 목업에서 세 화면이 같은 진행 줄과 '영상·장면 보기' 접이식을 쓴다. 화면마다 다시
 * 만들면 간격과 색이 조금씩 어긋나서 한곳에 둔다.
 */

/**
 * 번호가 붙은 2단계 스텝퍼 — ①목적 ②영상(pen P/Stepper, SOMA-748). 장면 단계는 SOMA-778에서 뺐다.
 * 지나온 단계와 지금 단계는 파란 동그라미에 번호(체크 아님), 이름은 진한 글자. 남은 단계는 회색 동그라미·회색 이름.
 * pen 03 「Stepper」 수치: 동그라미 20 · 번호 13/700, 6 띄워 이름 14/700, 단계 사이 10 · 18 줄 · 10.
 */
export function Stepper({ current }: { current: 1 | 2 }) {
  const labels = translateList('practiceChrome.steps');
  return (
    <View style={styles.stepper}>
      {labels.map((label, index) => {
        const step = index + 1;
        const passed = step < current;
        const active = step === current;
        return (
          <Fragment key={label}>
            {index > 0 && <View style={styles.stepperLine} />}
            <View style={styles.stepperItem}>
              <View style={[styles.circle, (passed || active) && styles.circleOn]}>
                <Text style={[styles.circleText, (passed || active) && styles.circleTextOn]}>{step}</Text>
              </View>
              <Text style={[styles.stepperLabel, (passed || active) && styles.stepperLabelOn]}>{label}</Text>
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

/** 3단계 진행 막대. 지금 단계만 길고 진하다. */
export function ProgressRow({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.progress}>
      <View style={styles.progressLeft}>
        <View style={styles.steps}>
          <View style={styles.stepDone} />
          <View style={styles.stepDone} />
          <View style={styles.stepNow} />
        </View>
        <Text style={styles.stepLabel}>{label}</Text>
      </View>
      {right}
    </View>
  );
}

/**
 * '영상 보기' 링크. 진행 줄 오른쪽에 놓는다.
 *
 * 펼친 내용은 이 링크 안에 두지 않는다 — 진행 줄은 좁은 가로 칸이라 영상이 그 안에
 * 갇혀 찌그러진다. 상태는 화면이 들고, 본문은 SceneFoldBody 가 전폭으로 그린다.
 */
export function SceneFoldLink({
  open,
  onToggle,
  label,
  track,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  /** 펼칠 때 어느 화면에서 펼쳤는지 기록한다(video_fold_open). */
  track?: PreviewScreen;
}) {
  return (
    <Pressable
      onPress={() => {
        if (!open && track) logFoldOpen(track);
        onToggle();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${open ? t('common.fold') : t('common.unfold')}`}
      accessibilityState={{ expanded: open }}
      // 글자는 12px 인데 화면 오른쪽 끝에 붙어 있어서, 누르는 칸을 글자보다 넓게 잡는다.
      // 애플이 권하는 최소 44pt 를 세로로 확보한다 — 손가락으로는 글자만큼 정확히 못 짚는다.
      style={({ pressed }) => [styles.foldTarget, pressed && styles.foldTargetOn]}
      hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}>
      <Text style={styles.foldLink}>
        {label} {open ? '▴' : '▾'}
      </Text>
    </Pressable>
  );
}

/**
 * 펼쳤을 때의 영상. 화면 폭을 그대로 쓴다.
 *
 * `videoUri` 가 문자열이 아니라 VideoSource 인 건 개발용 미리보기 때문이다 —
 * 번들에 든 샘플 파일은 `require()` 로 들어와서 문자열 경로가 아니다.
 */
export function SceneFoldBody({
  open,
  videoUri,
  track,
  startAt,
}: {
  open: boolean;
  videoUri: VideoSource | null;
  /** 펼친 영상을 실제로 틀었는지 기록한다(video_preview_play·end). */
  track?: PreviewScreen;
  /**
   * 코치 말 속 「0:12」를 눌렀을 때 그 초부터 튼다(pen 「추가 · 시간 눌러 장면 보기」, SOMA-748).
   * 같은 시간을 다시 눌러도 다시 감기도록 누를 때마다 `key`를 바꿔 준다. 영상 위에 「0:12부터」 표를 단다.
   */
  startAt?: { seconds: number; label: string; key: number } | null;
}) {
  const player = useVideoPlayer(open ? videoUri : null, (p) => {
    p.loop = false;
    limitVideoBuffer(p);
  });
  // 원본을 막 불러온 참이면 아직 감을 수 없다 — 재생 준비가 끝날 때 한 번 더 감는다.
  const pendingSeek = useRef<number | null>(null);
  useEffect(() => {
    if (!open || !startAt) return;
    pendingSeek.current = startAt.seconds;
    const seek = () => {
      if (pendingSeek.current === null) return;
      try {
        player.currentTime = pendingSeek.current;
        player.play();
        if (player.status === 'readyToPlay') pendingSeek.current = null;
      } catch {}
    };
    seek();
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') seek();
    });
    return () => sub.remove();
  }, [open, player, startAt]);
  // 빈 문자열만 '없음' 으로 본다. require() 로 들어온 에셋은 숫자라 truthy 검사로는
  // 걸러지지 않아야 한다.
  const hasVideo = videoUri != null && videoUri !== '';
  const videoKey = typeof videoUri === 'string' ? videoUri : hasVideo ? 'bundled' : null;
  // 접었다 다시 펼쳐도 같은 영상이면 다시 세지 않도록, 접힘 여부와 상관없이 같은 값을 준다.
  useVideoPreviewEvents(player, track ?? 'coach', track && hasVideo ? videoKey : null);
  if (!open) return null;
  return (
    <View style={styles.foldBody}>
      {hasVideo ? (
        <View>
          <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />
          {startAt ? (
            <View style={styles.seekBadge} pointerEvents="none">
              <Text style={styles.seekBadgeText}>{startAt.label}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={styles.foldEmpty}>{t('practiceChrome.noVideo')}</Text>
      )}
    </View>
  );
}

/** 제목·상황·인물·목표·막힌 곳 중 실제로 값이 있는 것만 라벨 열과 값 열로 늘어놓는다. */
export function SceneSummary({
  scene,
  blockage,
  title,
  practiceTitle,
}: {
  scene: SceneContext;
  blockage: { kind: string; detail: string | null } | null;
  title?: string;
  practiceTitle?: string | null;
}) {
  const labels = {
    title: t('practiceChrome.rowTitle'),
    situation: t('practiceChrome.rowSituation'),
    character: t('practiceChrome.rowCharacter'),
    goal: t('practiceChrome.rowGoal'),
    blockage: t('practiceChrome.rowBlockage'),
  };
  const rows = summaryRows({ title: practiceTitle, scene, blockageKind: blockage?.kind });
  const quote = blockage?.detail?.trim() || null;
  if (rows.length === 0 && !quote) return null;

  return (
    <View style={title ? styles.summaryWithTitle : undefined}>
      {title && <Text style={styles.summaryTitle}>{title}</Text>}
      <View style={styles.rows}>
        {rows.map((row) => (
          <View key={row.key} style={styles.row}>
            <View style={styles.rowLabelCell}>
              <Text style={styles.rowLabel}>{labels[row.key]}</Text>
            </View>
            <Text style={styles.rowValue}>{row.value}</Text>
          </View>
        ))}
        {quote ? (
          <View style={styles.quote}>
            <Text style={styles.quoteText}>“{quote}”</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** 화면 맨 아래 안내 문구. 세 화면이 같은 문장을 쓴다. */
export function PracticeFooter() {
  return (
    <View style={styles.footer}>
      <Text style={styles.footerText}>{t('practiceChrome.intro')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperLine: { width: 18, height: 1, backgroundColor: palette.border },
  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: palette.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleOn: { backgroundColor: palette.blue },
  circleText: { fontSize: 13, fontWeight: '700', lineHeight: 16, color: palette.textFaint },
  circleTextOn: { color: palette.bg },
  stepperLabel: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  stepperLabelOn: { color: palette.text },

  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  progressLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  steps: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepDone: { width: 18, height: 3, borderRadius: 9999, backgroundColor: palette.blueLine },
  stepNow: { width: 26, height: 3, borderRadius: 9999, backgroundColor: palette.blue },
  stepLabel: { fontSize: 12.5, fontWeight: '700', color: palette.textDim },

  // padding 으로 누르는 칸을 넓히고 같은 크기의 음수 margin 으로 되돌린다 — 진행 줄의
  // 높이는 목업 그대로 두면서 손가락이 닿는 면적만 키운다.
  foldTarget: { paddingVertical: 8, paddingHorizontal: 8, marginVertical: -8, marginHorizontal: -8 },
  foldTargetOn: { opacity: 0.4 },
  foldLink: { fontSize: 12, fontWeight: '700', color: palette.textFaint },
  foldBody: { paddingHorizontal: 20, paddingTop: 14 },
  foldEmpty: { fontSize: 12.5, fontWeight: '600', color: palette.textFaint },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: palette.bgSoft },
  seekBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: palette.blue,
    borderRadius: 9999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  seekBadgeText: { fontSize: 12, fontWeight: '800', color: palette.onAccent },

  summaryWithTitle: { borderTopWidth: 1, borderTopColor: palette.borderSoft, paddingTop: 20 },
  summaryTitle: { fontSize: 11.5, fontWeight: '900', color: palette.textFaint },
  rows: { paddingTop: 14, gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  rowLabelCell: { width: 52 },
  rowLabel: { fontSize: 12.5, fontWeight: '700', color: palette.checkOff },
  rowValue: { flex: 1, fontSize: 13.5, fontWeight: '600', color: palette.textDim, lineHeight: 22 },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: palette.border,
    paddingLeft: 14,
    paddingVertical: 2,
  },
  quoteText: { fontSize: 13, fontWeight: '600', color: palette.textMuted, lineHeight: 22 },

  footer: { gap: 8 },
  footerText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: palette.checkOff,
    lineHeight: 18,
  },
});

/** 연습 중 '영상·장면 보기'를 펼친 것을 남긴다. 화면 하나에서 여러 번 펼치면 그때마다 남는다. */
export function logFoldOpen(screen: PreviewScreen): void {
  void logEvent(FOLD_OPEN_EVENT, { screen });
}
