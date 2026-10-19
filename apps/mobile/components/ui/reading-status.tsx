import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

const MASCOT = require('@/assets/images/mascot-reading.png');

type Action = { label: string; onPress: () => void; loading?: boolean };

/**
 * pen 「대본을 못 나눴어요」·「상대역 목소리를 못 만들었어요」(SOMA-748) — 위 꺾쇠, 가운데 마스코트·제목 23/900·설명 15/500,
 * 아래 [주 버튼]·[보조 버튼]. 리딩의 실패·권한 안내 화면이 함께 쓴다.
 */
export function ReadingStatus({
  title,
  body,
  note,
  primary,
  secondary,
  onBack,
  icon,
  children,
}: {
  title: string;
  body?: string;
  /** 설명 아래 흐린 한 줄(원인 등). */
  note?: string;
  primary?: Action;
  secondary?: Action;
  onBack?: () => void;
  /** 마스코트 대신 보일 아이콘. */
  icon?: React.ComponentProps<typeof Feather>['name'];
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 10 }]}>
      <View style={styles.head}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.back')} ph-label="reading_status_back">
            <Feather name="chevron-left" size={26} color={palette.text} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.body}>
        {icon ? (
          <View style={styles.iconCircle}>
            <Feather name={icon} size={34} color={palette.blue} />
          </View>
        ) : (
          <Image source={MASCOT} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
        )}
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.text}>{body}</Text> : null}
        {note ? <Text style={styles.note}>{note}</Text> : null}
        {children}
      </View>
      <View style={styles.foot}>
        {primary ? <PrimaryButton label={primary.label} onPress={primary.onPress} loading={primary.loading} /> : null}
        {secondary ? <SecondaryButton label={secondary.label} onPress={secondary.onPress} loading={secondary.loading} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  head: { height: 52, paddingHorizontal: 14, justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 60, gap: 14 },
  mascot: { width: 84, height: 94 },
  iconCircle: { width: 84, height: 84, borderRadius: 42, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 23, fontWeight: '900', lineHeight: 33, color: palette.text, textAlign: 'center' },
  text: { fontSize: 15, fontWeight: '500', lineHeight: 23, color: palette.textDim, textAlign: 'center' },
  note: { fontSize: 13, fontWeight: '500', lineHeight: 19, color: palette.textFaint, textAlign: 'center' },
  foot: { paddingHorizontal: 24, paddingTop: 12, gap: 10 },
});
