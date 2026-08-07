import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';

import { palette } from '@/constants/palette';
import type { SceneContext } from '@/lib/api';

/**
 * 연습 흐름(막히는 지점 → 분석 → 질문 대화)의 화면들이 공유하는 머리 부분.
 *
 * 목업에서 세 화면이 같은 진행 줄과 '영상·장면 보기' 접이식을 쓴다. 화면마다 다시
 * 만들면 간격과 색이 조금씩 어긋나서 한곳에 둔다.
 */

/**
 * 번호가 붙은 3단계 스텝퍼 — ①영상 올리기 ②장면 적기 ③질문 받기.
 *
 * 업로드 화면에 이게 없어서, 다음 화면의 '3단계 · 질문 받기' 가 맥락 없이 튀어나왔다.
 * 지나온 단계는 체크로, 지금 단계는 진하게 둔다.
 */
export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const labels = ['영상 올리기', '장면 적기', '질문 받기'];
  return (
    <View style={styles.stepper}>
      {labels.map((label, index) => {
        const step = (index + 1) as 1 | 2 | 3;
        const passed = step < current;
        const active = step === current;
        return (
          <View key={label} style={styles.stepperItem}>
            {index > 0 && <View style={styles.stepperLine} />}
            <View style={[styles.circle, (passed || active) && styles.circleOn]}>
              <Text style={[styles.circleText, (passed || active) && styles.circleTextOn]}>
                {passed ? '✓' : step}
              </Text>
            </View>
            <Text style={[styles.stepperLabel, active && styles.stepperLabelOn]}>
              {label}
            </Text>
          </View>
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
  label = '영상 보기',
}: {
  open: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${open ? '접기' : '펼치기'}`}
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
}: {
  open: boolean;
  videoUri: VideoSource | null;
}) {
  const player = useVideoPlayer(open ? videoUri : null, (p) => {
    p.loop = false;
  });
  if (!open) return null;
  // 빈 문자열만 '없음' 으로 본다. require() 로 들어온 에셋은 숫자라 truthy 검사로는
  // 걸러지지 않아야 한다.
  const hasVideo = videoUri != null && videoUri !== '';
  return (
    <View style={styles.foldBody}>
      {hasVideo ? (
        <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />
      ) : (
        <Text style={styles.foldEmpty}>다시 볼 수 있는 영상이 없어요.</Text>
      )}
    </View>
  );
}

/** 상황·인물·목표(+막힌 곳)를 라벨 열과 값 열로 늘어놓는다. */
export function SceneSummary({
  scene,
  blockage,
  title,
}: {
  scene: SceneContext;
  blockage: { kind: string; detail: string | null } | null;
  title?: string;
}) {
  const rows: [string, string][] = [
    ['상황', scene.situation],
    ['인물', scene.character],
    ['목표', scene.goal],
  ];
  if (blockage?.kind) rows.push(['막힌 곳', blockage.kind]);

  return (
    <View style={title ? styles.summaryWithTitle : undefined}>
      {title && <Text style={styles.summaryTitle}>{title}</Text>}
      <View style={styles.rows}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <View style={styles.rowLabelCell}>
              <Text style={styles.rowLabel}>{label}</Text>
            </View>
            <Text style={styles.rowValue}>{value.trim() || '적지 않았어요'}</Text>
          </View>
        ))}
        {blockage?.detail ? (
          <View style={styles.quote}>
            <Text style={styles.quoteText}>“{blockage.detail}”</Text>
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
      <Text style={styles.footerText}>
        영상에서 눈에 남은 곳을 묻고, 마지막 한 문장은 배우님이 직접 써요.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperLine: { width: 20, height: 1, backgroundColor: palette.border, marginRight: 2 },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: palette.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleOn: { backgroundColor: palette.blue },
  circleText: { fontSize: 11, fontWeight: '900', color: palette.textFaint },
  circleTextOn: { color: palette.bg },
  stepperLabel: { fontSize: 12, fontWeight: '700', color: palette.textFaint },
  stepperLabelOn: { fontWeight: '900', color: palette.text },

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
