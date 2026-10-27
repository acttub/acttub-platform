import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { BackOnlyHeader } from '@/components/ui/step-header';
import { palette } from '@/constants/palette';

export type StatusAction = { label: string; onPress: () => void; loading?: boolean };

/**
 * 한 장짜리 상태 화면 공통 부품(SOMA-770) — pen 「카메라와 마이크가 필요해요」·「공고를 불러오지 못했어요」·「대본을 못 나눴어요」·
 * 「알림이 꺼져 있어요」·「가입할 수 없어요」가 같은 틀이다.
 *
 * 본문 안쪽 [16,24,24,24] · 위 여백 90 · 액티 84×94 · 10 띄우고 제목 23/900(줄높이 1.42) · 22 띄우고 설명 15/500 #4E5968(줄높이 1.5).
 * 설명이 누를 곳을 알려 주는 말이면 `bodyTone="blue"`(15/700 #1B64DA). 아래 [주 버튼]·[보조 버튼](공통 Button).
 * `size="large"`는 「가입할 수 없어요」 — 위 여백 120 · 액티 120×132 · 제목 24/800 · 설명 16/500 #6B7684(줄높이 1.6), 가운데 정렬 묶음 간격 12.
 */
export function StatusScreen({
  mascot = MASCOT.coach,
  icon,
  title,
  body,
  bodyTone = 'dim',
  note,
  primary,
  secondary,
  actions,
  onBack,
  safeArea = false,
  size = 'default',
  children,
}: {
  mascot?: ImageSourcePropType;
  /** 액티 대신 보일 아이콘(파란 원 84). */
  icon?: React.ComponentProps<typeof Feather>['name'];
  title: string;
  body?: string | null;
  bodyTone?: 'dim' | 'blue';
  /** 설명 아래 흐린 한 줄(원인 등). */
  note?: string | null;
  primary?: StatusAction;
  secondary?: StatusAction;
  /** 버튼을 직접 줄 때(primary/secondary 대신). */
  actions?: ReactNode;
  /** 있으면 왼쪽 위 꺾쇠 머리(높이 52)를 그린다. */
  onBack?: () => void;
  /** 화면 전체를 이 부품이 차지할 때 위·아래 안전 영역을 띄운다. */
  safeArea?: boolean;
  size?: 'default' | 'large';
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const large = size === 'large';
  const hasActions = !!(actions || primary || secondary);
  return (
    <View style={[styles.root, safeArea && { paddingTop: insets.top }]}>
      {onBack ? <BackOnlyHeader onBack={onBack} /> : null}
      <View style={[styles.body, large && styles.bodyLarge]}>
        <View style={[styles.head, large && styles.headLarge]}>
          {icon ? (
            <View style={styles.iconCircle}>
              <Feather name={icon} size={34} color={palette.blue} />
            </View>
          ) : (
            <Image
              source={mascot}
              style={large ? MASCOT_SIZE.xl : MASCOT_SIZE.lg}
              contentFit="contain"
              cachePolicy="memory-disk"
              accessibilityIgnoresInvertColors
            />
          )}
          <Text style={[styles.title, large && styles.titleLarge]}>{title}</Text>
          {large && body ? <Text style={styles.bodyTextLarge}>{body}</Text> : null}
        </View>
        {!large && body ? <Text style={[styles.bodyText, bodyTone === 'blue' && styles.bodyBlue]}>{body}</Text> : null}
        {note ? <Text style={styles.note}>{note}</Text> : null}
        {children}
      </View>
      {hasActions ? (
        <CtaBar safeBottom={safeArea}>
          {actions}
          {primary ? <PrimaryButton label={primary.label} onPress={primary.onPress} loading={primary.loading} /> : null}
          {secondary ? <SecondaryButton label={secondary.label} onPress={secondary.onPress} loading={secondary.loading} /> : null}
        </CtaBar>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  body: { flex: 1, paddingTop: 16 + 90 + 22, paddingHorizontal: 24, paddingBottom: 24, gap: 22, alignItems: 'center' },
  bodyLarge: { paddingTop: 16 + 120, paddingHorizontal: 32 },
  head: { alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  headLarge: { gap: 12 },
  iconCircle: { width: 84, height: 84, borderRadius: 42, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 23, fontWeight: '900', lineHeight: 33, color: palette.text, textAlign: 'center' },
  titleLarge: { fontSize: 24, fontWeight: '800', lineHeight: 34 },
  bodyText: { fontSize: 15, fontWeight: '500', lineHeight: 23, color: palette.textSub, textAlign: 'center', alignSelf: 'stretch' },
  bodyBlue: { fontWeight: '700', color: palette.blueDeep },
  bodyTextLarge: { fontSize: 16, fontWeight: '500', lineHeight: 26, color: palette.textMeta, textAlign: 'center' },
  note: { fontSize: 13, fontWeight: '500', lineHeight: 19, color: palette.textMeta, textAlign: 'center', marginTop: -10 },
});
