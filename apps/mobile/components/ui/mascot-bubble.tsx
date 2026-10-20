import { Image } from 'expo-image';
import { StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';

/**
 * pen 「캐릭터 말풍선」(SOMA-770 공통) — 왼쪽 액티(70×78), 오른쪽 회색 말풍선(#F2F4F6, 모서리 18 · 왼쪽 아래만 4, 안쪽 14/16).
 * 큰 글 20/800. 아래 줄은 `guide`(파란 안내 14/700, 누를 곳을 알려 주는 말) 또는 `body`(회색 보조 14/600).
 * 온보딩·코칭 준비·코칭/리딩 입구가 모두 이것을 쓴다.
 */
export function MascotBubble({
  source = MASCOT.coach,
  title,
  body,
  guide,
}: {
  source?: ImageSourcePropType;
  title: string;
  body?: string | null;
  guide?: string | null;
}) {
  return (
    <View style={styles.row}>
      <Image source={source} style={MASCOT_SIZE.md} contentFit="contain" accessibilityIgnoresInvertColors />
      <View style={styles.bubble}>
        <Text style={styles.title}>{title}</Text>
        {guide ? <Text style={styles.guide}>{guide}</Text> : null}
        {body ? <Text style={styles.body}>{body}</Text> : null}
      </View>
    </View>
  );
}

/** 코칭 준비 화면의 말풍선 — 갸웃하는 액티 + 파란 안내. */
export function CoachBubble({ title, guide }: { title: string; guide?: string | null }) {
  return <MascotBubble source={MASCOT.coach} title={title} guide={guide} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  bubble: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: palette.bgSoft,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 4,
  },
  title: { fontSize: 20, fontWeight: '800', lineHeight: 28, color: palette.text },
  guide: { fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.blueDeep },
  body: { fontSize: 14, fontWeight: '600', lineHeight: 21, color: palette.textMuted },
});
