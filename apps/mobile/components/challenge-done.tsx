import Feather from '@expo/vector-icons/Feather';
import { Stack } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AdSlot } from '@/components/ad-slot';
import { DoneScreen } from '@/components/ui/done-screen';
import { MASCOT } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export type ChallengeDoneRow = { key: string; icon: FeatherName; title: string; sub: string; onPress: () => void };

/**
 * 챌린지 올리기 완료 — 디자인 시스템 「DoneScreen」 한 꼴. 첫 참여와 그 뒤가 같은 모양이고 제목(첫 참여는 축하 문구)만 다르다.
 * 머리 없음 · 마스코트 · 제목 · 「“대사” · …」 한 줄 · 다음 행동 줄(SNS 공유 · 이 영상으로 코칭 받기 · 다른 참여작 보기) · 아래 「홈으로 가기」.
 */
export function ChallengeDone({
  title,
  sub,
  rows,
  onHome,
}: {
  title: string;
  sub: string;
  rows: ChallengeDoneRow[];
  onHome: () => void;
}) {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DoneScreen mascot={MASCOT.cheer} title={title} scriptName={sub} onHome={onHome}>
        <View style={styles.rows}>
          {rows.map((row) => (
            <Pressable
              key={row.key}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={row.onPress}
              accessibilityRole="button"
              accessibilityLabel={row.title}>
              <View style={styles.rowIcon}>
                <Feather name={row.icon} size={18} color={palette.blueDeep} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowSub}>{row.sub}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={palette.iconFaint} />
            </Pressable>
          ))}
        </View>
        {/* 광고 칸(SOMA-876) — 다음 행동 줄 아래, 아래 고정 버튼 위. */}
        <AdSlot slot="challenge_upload_done" style={styles.ad} />
      </DoneScreen>
    </>
  );
}

const styles = StyleSheet.create({
  rows: { paddingTop: space[4] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  rowIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...type.body1Bold, color: palette.text },
  rowSub: { ...type.caption, color: palette.textMeta },
  pressed: { opacity: 0.7 },
  ad: { marginTop: space[3] },
});
