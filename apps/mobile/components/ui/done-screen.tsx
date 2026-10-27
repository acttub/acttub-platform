import { Image } from 'expo-image';
import type { ReactNode, Ref } from 'react';
import { ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardLift } from '@/components/keyboard-lift';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

/**
 * 완료 화면 틀 — 디자인 시스템 pen 「DoneScreen」. 첫 완료와 그 뒤 완료가 같은 꼴이다.
 * 머리 없음 · 마스코트 120 · 제목 title1 · 대본 이름 body2 `text-sub` · 내용 칸(요약 · 다음 행동, `children`) · 아래 고정 「홈으로 가기」 하나.
 * `mascotTop`은 아래 내용이 많은 그 뒤 리딩 완료(DESIGN-SYSTEM 「의도된 차이」) — 마스코트를 상태 막대 바로 아래(24)에 둔다.
 * `footer`는 아래 고정 바에서 「홈으로 가기」 바로 위에 두는 보조 줄이다. 내용 칸의 입력칸이 키보드에 가리지 않게 키보드만큼 올린다.
 */
export function DoneScreen({
  mascot = MASCOT.jump,
  title,
  scriptName,
  children,
  onHome,
  homeDisabled,
  mascotTop,
  footer,
  scrollRef,
}: {
  mascot?: ImageSourcePropType;
  title: string;
  scriptName?: string | null;
  children?: ReactNode;
  onHome: () => void;
  homeDisabled?: boolean;
  mascotTop?: boolean;
  footer?: ReactNode;
  scrollRef?: Ref<ScrollView>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardLift style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.body, mascotTop && styles.bodyTop]}>
        <Image source={mascot} style={MASCOT_SIZE.xl} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {scriptName ? <Text style={styles.script}>{scriptName}</Text> : null}
        {children ? <View style={styles.content}>{children}</View> : null}
      </ScrollView>
      <CtaBar>
        {footer}
        <PrimaryButton label={t('challengeDone.home')} onPress={onHome} disabled={homeDisabled} />
      </CtaBar>
    </KeyboardLift>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  body: { paddingTop: 96, paddingHorizontal: space.gutter, paddingBottom: space[6], gap: space[3], alignItems: 'center' },
  bodyTop: { paddingTop: space[6] },
  title: { ...type.title1, color: palette.text, textAlign: 'center' },
  script: { ...type.body2, color: palette.textSub, textAlign: 'center' },
  // 요약·다음 행동 칸은 화면 폭을 채운다(pen 「content slot」 fill).
  content: { alignSelf: 'stretch' },
});
