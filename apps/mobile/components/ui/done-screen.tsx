import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

/**
 * 완료 화면 틀 — 디자인 시스템 pen 「DoneScreen」. 첫 완료와 그 뒤 완료가 같은 꼴이다.
 * 머리 없음 · 마스코트 120 · 제목 title1 · 대본 이름 body2 `text-sub` · 내용 칸(요약 · 다음 행동, `children`) · 아래 고정 「홈으로 가기」 하나.
 */
export function DoneScreen({
  mascot = MASCOT.jump,
  title,
  scriptName,
  children,
  onHome,
}: {
  mascot?: ImageSourcePropType;
  title: string;
  scriptName?: string | null;
  children?: ReactNode;
  onHome: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.body}>
        <Image source={mascot} style={MASCOT_SIZE.xl} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {scriptName ? <Text style={styles.script}>{scriptName}</Text> : null}
        {children}
      </ScrollView>
      <CtaBar>
        <PrimaryButton label={t('challengeDone.home')} onPress={onHome} />
      </CtaBar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  body: { paddingTop: 96, paddingHorizontal: space.gutter, paddingBottom: space[6], gap: space[3], alignItems: 'center' },
  title: { ...type.title1, color: palette.text, textAlign: 'center' },
  script: { ...type.body2, color: palette.textSub, textAlign: 'center' },
});
