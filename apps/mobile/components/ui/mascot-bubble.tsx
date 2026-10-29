import { Image } from 'expo-image';
import { StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';

/**
 * pen 「온보딩 / 질문 말풍선」(파이프라인 반영버전 공통) — 왼쪽 액티(52×61, 아래 4 띄움), 13 띄워 회색 말풍선
 * (#F2F4F6, 모서리 16, 안쪽 [11,14,12,14], 줄 사이 5). 질문 19/700(줄 25).
 * 아래 줄은 `guide`(파란 안내 15/600 #3268D8, 누를 곳을 알려 주는 말) 또는 `body`(회색 보조 15/600).
 * 온보딩·코칭 준비·코칭/리딩 입구가 모두 이것을 쓴다.
 */
export function MascotBubble({
  source = MASCOT.coach,
  title,
  body,
  guide,
  question = false,
}: {
  source?: ImageSourcePropType;
  title: string;
  body?: string | null;
  guide?: string | null;
  /** 가입 질문 말풍선 — 안쪽 사방 16, 제목 headline, 안내 body2(디자인 시스템 「의도된 차이」). */
  question?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.mascot}>
        <Image source={source} style={MASCOT_SIZE.bubble} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
      </View>
      <View style={[styles.bubble, question && styles.questionBubble]}>
        <Text style={[styles.title, question && styles.questionTitle]}>{title}</Text>
        {guide ? <Text style={[styles.guide, question && styles.questionSmall]}>{guide}</Text> : null}
        {body ? <Text style={[styles.body, question && styles.questionSmall]}>{body}</Text> : null}
      </View>
    </View>
  );
}

/** 코칭 준비 화면의 말풍선 — 갸웃하는 액티 + 파란 안내. */
export function CoachBubble({ title, guide }: { title: string; guide?: string | null }) {
  return <MascotBubble source={MASCOT.coach} title={title} guide={guide} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 13, paddingLeft: 6 },
  mascot: { paddingBottom: 4 },
  bubble: {
    flex: 1,
    minWidth: 0,
    gap: 5,
    paddingTop: 11,
    paddingBottom: 12,
    paddingHorizontal: 14,
    backgroundColor: palette.bgSoft,
    borderRadius: 16,
  },
  questionBubble: { padding: space[4] },
  title: { fontSize: 19, fontWeight: '700', lineHeight: 25, color: palette.text },
  questionTitle: type.headline,
  questionSmall: type.body2,
  guide: { fontSize: 15, fontWeight: '600', lineHeight: 20, color: palette.blueDeep },
  body: { fontSize: 15, fontWeight: '600', lineHeight: 20, color: palette.textMeta },
});
