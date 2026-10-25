import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, TextButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT as MASCOTS } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export type ChallengeDoneRow = { key: string; icon: FeatherName; title: string; sub: string; onPress: () => void };

/**
 * 챌린지 올리기 완료·마무리(pen C9.12 · C19.1 · C19.3) — 공개·비공개가 같은 모양이고 제목만 다르다.
 * 가운데 액티 → 제목 → 「“대사” · …」 한 줄 → 이어서 할 일 줄(SNS 공유 · 이 영상으로 코칭 받기 · 다른 참여작 보기) → 「홈으로 가기」.
 * 첫 참여 끝(C19.3)은 줄 대신 「홈으로 가기」와 글자 「SNS에 공유하기」·「이 영상으로 코칭 받기」를 둔다
 * (폰 테스트 10/23: 첫 참여에서도 코칭으로 바로 이어지게).
 */
export function ChallengeDone({
  title,
  sub,
  rows,
  first = false,
  onHome,
  onShare,
  onCoach,
}: {
  title: string;
  sub: string;
  rows: ChallengeDoneRow[];
  /** 첫 챌린지 참여 끝 — 줄 대신 큰 칭찬과 「SNS에 공유하기」 글자 버튼. */
  first?: boolean;
  onHome: () => void;
  /** 첫 참여 끝에서 보이는 공유 글자 버튼. 없으면 그리지 않는다. */
  onShare?: (() => void) | null;
  /** 첫 참여 끝에서 보이는 「이 영상으로 코칭 받기」 글자 버튼. 없으면 그리지 않는다. */
  onCoach?: (() => void) | null;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: first ? t('challengeDone.firstNav') : '' }} />
      <ScrollView contentContainerStyle={[styles.content, first && styles.contentFirst]}>
        <Image source={MASCOTS.cheer} style={[styles.mascot, first && styles.mascotFirst]} contentFit="contain" accessibilityIgnoresInvertColors />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>
        {!first && rows.length > 0 && (
          <View style={styles.rows}>
            {rows.map((row) => (
              <Pressable
                key={row.key}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={row.onPress}
                accessibilityRole="button"
                accessibilityLabel={row.title}>
                <View style={styles.rowIcon}>
                  <Feather name={row.icon} size={18} color={palette.blue} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{row.title}</Text>
                  <Text style={styles.rowSub}>{row.sub}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={palette.checkOff} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
      <CtaBar safeBottom={false}>
        <PrimaryButton label={t('challengeDone.home')} onPress={onHome} />
        {first && onShare ? <TextButton label={t('challengeDone.share')} tone="accent" size="large" onPress={onShare} /> : null}
        {first && onCoach ? <TextButton label={t('challengeDone.coach')} tone="accent" size="large" onPress={onCoach} /> : null}
      </CtaBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 24, alignItems: 'center' },
  contentFirst: { paddingBottom: 80 },
  mascot: { width: 130, height: 148 },
  mascotFirst: { width: 150, height: 170 },
  title: { fontSize: 24, fontWeight: '800', lineHeight: 33, letterSpacing: -0.5, color: palette.text, textAlign: 'center', marginTop: 12 },
  sub: { fontSize: 14, fontWeight: '500', lineHeight: 20, color: palette.textFaint, textAlign: 'center', marginTop: 12 },
  rows: { alignSelf: 'stretch', gap: 0, paddingTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '700', color: palette.text, lineHeight: 22 },
  rowSub: { fontSize: 13, fontWeight: '500', color: palette.textFaint, lineHeight: 18 },
  pressed: { opacity: 0.85 },
});
