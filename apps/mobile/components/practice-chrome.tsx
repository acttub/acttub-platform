import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { palette } from '@/constants/palette';
import type { SceneContext } from '@/lib/api';

/**
 * 연습 흐름(막히는 지점 → 분석 → 질문 대화)의 화면들이 공유하는 머리 부분.
 *
 * 목업에서 세 화면이 같은 진행 줄과 '영상·장면 보기' 접이식을 쓴다. 화면마다 다시
 * 만들면 간격과 색이 조금씩 어긋나서 한곳에 둔다.
 */

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
 * 영상과 장면을 접었다 펼치는 줄.
 *
 * 목업은 이 흐름에서 영상을 늘 띄우지 않고 필요할 때만 펼친다 — 질문에 집중하게
 * 하려는 것이다. 다만 영상 자체를 없애지는 않는다(펼치면 그대로 재생된다).
 */
export function SceneFold({
  videoUri,
  scene,
  blockage,
}: {
  videoUri: string | null;
  scene: SceneContext | null;
  blockage?: { kind: string; detail: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const player = useVideoPlayer(open ? videoUri : null, (p) => {
    p.loop = false;
  });

  return (
    <View>
      <Pressable
        onPress={() => setOpen((was) => !was)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={8}>
        <Text style={styles.foldLink}>영상·장면 보기 {open ? '▴' : '▾'}</Text>
      </Pressable>
      {open && (
        <View style={styles.foldBody}>
          {videoUri && (
            <VideoView
              style={styles.video}
              player={player}
              nativeControls
              contentFit="contain"
            />
          )}
          {scene && (
            <SceneSummary scene={scene} blockage={blockage ?? null} />
          )}
        </View>
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

  foldLink: { fontSize: 12, fontWeight: '700', color: palette.textFaint },
  foldBody: { gap: 14, paddingTop: 14 },
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
