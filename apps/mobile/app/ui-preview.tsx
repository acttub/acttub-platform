import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { seedPendingUpload, seedPractice } from '@/lib/ui-preview';

/**
 * 화면만 보는 통로 — 개발 빌드 전용.
 *
 * 연습 화면들은 영상 업로드와 Gemini 분석을 지나야 나온다. 배치·문구만 고칠 때마다
 * 그 몇 분을 기다리지 않도록, 가짜 데이터를 심고 해당 화면으로 바로 넘긴다.
 *
 * 배포 빌드에서는 열리지 않는다(`__DEV__` 가드). 여기서 만든 상태는 서버에 아무것도
 * 보내지 않는다 — 화면이 읽는 모듈 스토어만 채운다.
 */
export default function UiPreviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const jumped = useRef(false);

  if (!__DEV__) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '미리보기' }} />
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>개발 빌드에서만 열려요.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const items: { key: string; label: string; hint: string; go: () => void }[] = [
    {
      key: 'blockage',
      label: '막히는 지점 · 3단계',
      hint: '대분류 → 세부 → 서술로 적기 · 영상 보기',
      go: () => {
        seedPendingUpload();
        router.push('/blockage?preview=1');
      },
    },
    {
      key: 'analyzing',
      label: '분석 진행',
      hint: '진행 표시 · 분석에 쓰는 내용 · 영상 보기',
      go: () => {
        seedPractice();
        router.push('/analyzing?preview=1');
      },
    },
    {
      key: 'coach',
      label: '질문 대화',
      hint: '질문 하나 + 지난 문답 접기',
      go: () => {
        seedPractice({ withTurns: true });
        router.push('/coach');
      },
    },
    {
      key: 'report',
      label: '분석 결과',
      hint: '구분선 섹션 · 다음 테이크 · 영상 보기',
      go: () => {
        seedPractice({ withTurns: true, withReport: true });
        router.push('/report?preview=1');
      },
    },
  ];

  // `actingapp://ui-preview?go=report` 처럼 곧장 한 화면으로 뛴다. 손으로 눌러
  // 들어가는 것과 같은 경로를 타므로 가짜 데이터도 똑같이 심긴다.
  // eslint-disable-next-line react-hooks/rules-of-hooks -- 위 __DEV__ 분기는 빌드마다 고정이다
  useEffect(() => {
    if (jumped.current) return;
    const target = items.find((item) => item.key === params.go);
    if (!target) return;
    jumped.current = true;
    target.go();
  });

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'UI 미리보기', headerShadowVisible: false }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.notice}>
          가짜 장면과 가짜 카드로 화면만 띄워요. 서버에는 아무것도 보내지 않아요.
        </Text>
        {items.map((item) => (
          <Pressable key={item.label} style={styles.row} onPress={item.go}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{item.label}</Text>
              <Text style={styles.rowHint}>{item.hint}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  blocked: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  blockedText: { fontSize: 14, fontWeight: '600', color: palette.textFaint },
  body: { padding: 20, gap: 10 },
  notice: {
    fontSize: 12.5,
    fontWeight: '600',
    color: palette.textFaint,
    lineHeight: 21,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  rowText: { flex: 1, gap: 4 },
  rowLabel: { fontSize: 15, fontWeight: '900', color: palette.text },
  rowHint: { fontSize: 12.5, fontWeight: '600', color: palette.textFaint },
  chevron: { fontSize: 16, fontWeight: '700', color: palette.checkOff },
});
