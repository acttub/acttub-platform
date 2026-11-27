import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { easing, motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { type } from '@/constants/tokens';
import { useCommunityPrompt } from '@/hooks/use-community-prompt';
import type { CommunityPromptInput, CommunityPromptKind } from '@/lib/community-prompt';
import { translate as t } from '@/lib/i18n';

/**
 * 리딩 완료 화면의 「이 장면 같이 할 상대역 구하기」·「다른 배우한테 물어보기」 줄(SOMA-1054). 모양은 바로 위 발음 보고서 줄
 * (components/reading-after-card)과 같은 글자 줄 + 꺾쇠다. 회원이 아니면 그리지 않는다. 동작 줄이기를 켰으면 떠오르지 않는다.
 */
export function CommunityPromptRows({ input }: { input: CommunityPromptInput }) {
  const { visible, open } = useCommunityPrompt('reading_done', true, input);
  const reduceMotion = useReducedMotion();
  if (!visible) return null;
  const row = (kind: CommunityPromptKind, label: string) => (
    <Pressable
      onPress={() => open(kind)}
      accessibilityRole="button"
      accessibilityLabel={label}
      ph-label={`community_prompt_${kind}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Text style={styles.rowText}>{label}</Text>
      <Feather name="chevron-right" size={16} color={palette.iconFaint} />
    </Pressable>
  );
  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(motion.standard).easing(easing.enter)} style={styles.wrap}>
      {row('partner', t('communityPrompt.partner'))}
      {row('question', t('communityPrompt.question'))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 14, paddingHorizontal: 8 },
  rowText: { flex: 1, ...type.body2Bold, color: palette.textSub },
  pressed: { opacity: 0.8 },
});
