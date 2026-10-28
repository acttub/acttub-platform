// 10/27 디자인 개편 모양 그대로(SOMA-923). 개편후 모양을 유지하기로 한 화면만 쓴다.
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { type ImageSourcePropType, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ds/ui/buttons';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { NavBackButton, NavHeader } from '@/components/ds/ui/nav-header';
import { SkeletonBlock, SkeletonGroup } from '@/components/ds/ui/skeleton';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

export type StatusAction = { label: string; onPress: () => void; loading?: boolean };

/**
 * 화면 전체가 오류·빈 상태·불러오는 중일 때의 틀 — 디자인 시스템 pen 「StatusScreen」.
 *
 * - error: 마스코트 120 · 제목 title1 · 설명 body2 `text-sub` · 버튼(Button md, 폭 200 가운데).
 * - empty: 같은 틀에 마스코트 96 · 제목 title2. 오류 색을 쓰지 않는다.
 * - loading: 행 뼈대 셋(막대 220 · 가득 · 160).
 *
 * 머리는 `header`(그 화면 이름)나 `onBack`이 있을 때 NavHeader 로 그린다. 버튼은 아래 고정 바가 아니라 문구 바로 아래 가운데다.
 */
export function StatusScreen({
  kind = 'error',
  header,
  onBack,
  mascot = MASCOT.dizzy,
  title,
  body,
  note,
  primary,
  secondary,
  children,
  safeArea = false,
}: {
  kind?: 'error' | 'empty' | 'loading';
  header?: string;
  onBack?: () => void;
  mascot?: ImageSourcePropType;
  title?: string;
  body?: string | null;
  /** 설명 아래 흐린 한 줄(원인 등). */
  note?: string | null;
  primary?: StatusAction;
  secondary?: StatusAction;
  /** 설명 아래, 버튼 위에 두는 한 줄(누른 일 실패의 InlineError/Line, 버튼 대신 굵은 안내 등). */
  children?: ReactNode;
  /** 화면 전체를 이 부품이 차지할 때 위·아래 안전 영역을 띄운다. */
  safeArea?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const empty = kind === 'empty';
  return (
    <View style={[styles.root, safeArea && { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {header || onBack ? <NavHeader title={header} left={onBack ? <NavBackButton onPress={onBack} /> : null} /> : null}
      {kind === 'loading' ? (
        <SkeletonGroup style={styles.loading}>
          {[0, 1, 2].map((row) => (
            <View key={row} style={styles.skeletonRow}>
              {([220, '100%', 160] as const).map((width, bar) => (
                <SkeletonBlock key={bar} width={width} height={14} radius={radius.xs} />
              ))}
            </View>
          ))}
        </SkeletonGroup>
      ) : (
        // 작은 기기·큰 글자에서도 버튼까지 닿게 본문을 스크롤로 둔다.
        <ScrollView contentContainerStyle={styles.body}>
          <Image
            source={mascot}
            style={empty ? MASCOT_SIZE.empty : MASCOT_SIZE.xl}
            contentFit="contain"
            cachePolicy="memory-disk"
            accessibilityIgnoresInvertColors
          />
          {title ? <Text style={[styles.title, empty && styles.titleEmpty]}>{title}</Text> : null}
          {body ? <Text style={styles.text}>{body}</Text> : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}
          {children}
          {primary || secondary ? (
            <View style={styles.actions}>
              {primary ? <Button size="md" label={primary.label} onPress={primary.onPress} loading={primary.loading} /> : null}
              {secondary ? (
                <Button size="md" variant="secondary" label={secondary.label} onPress={secondary.onPress} loading={secondary.loading} />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  body: { paddingTop: 96, paddingHorizontal: space.gutter, paddingBottom: space[6], gap: space[3], alignItems: 'center' },
  title: { ...type.title1, color: palette.text, textAlign: 'center' },
  titleEmpty: type.title2,
  text: { ...type.body2, color: palette.textSub, textAlign: 'center' },
  note: { ...type.caption, color: palette.textMeta, textAlign: 'center' },
  actions: { width: 200, marginTop: space[1], gap: space[2] },
  loading: { paddingVertical: space[4], paddingHorizontal: space.gutter, gap: space[6] },
  skeletonRow: { paddingVertical: space[2], gap: space[3] },
});
