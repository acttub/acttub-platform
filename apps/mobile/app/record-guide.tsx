import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { NavIconButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { translate as t, translateList } from '@/lib/i18n';

/**
 * 찍는 법 한 장(pen 「새 · 찍는 법 한 장」, SOMA-748). 새 연습의 영상 고르기에서 「지금 찍기」를 누르면 카메라 전에 한 번 보인다.
 * 「촬영 시작」은 이 화면을 카메라로 바꾼다 — 찍고 나면 카메라가 뒤로 가며 바로 새 연습 준비로 돌아간다.
 * 코칭 탭의 「지금 찍어서 코칭 받기」(next=upload)에서 왔으면 찍은 뒤 새 연습 준비를 새로 연다.
 */
export default function RecordGuideScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ first?: string; next?: string }>();
  const firstTime = params.first === '1';
  // next=upload: 코칭 탭 「지금 찍어서 코칭 받기」에서 옴 — 찍은 뒤 뒤로 가지 않고 새 연습 준비를 연다.
  const toUpload = params.next === 'upload';
  const tips = translateList('record.guideTips');

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: t('record.guideTitle'),
          headerShadowVisible: false,
          // pen 03 「찍는 법」 머리 — 오른쪽 설정 아이콘(24).
          headerRight: () => (
            <NavIconButton icon="settings" size={24} label={t('settings.title')} phLabel="record_guide_settings" onPress={() => router.push('/settings')} />
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.hero}>
          <Feather name="smartphone" size={56} color={palette.blue} />
          <Text style={styles.heroText}>{t('record.guideHero')}</Text>
        </View>
        <View>
          {tips.map((tip) => (
            <View key={tip} style={styles.row}>
              <Feather name="check" size={20} color={palette.blue} />
              <Text style={styles.rowText}>{tip}</Text>
            </View>
          ))}
        </View>
        {firstTime && <Text style={styles.guide}>{t('record.guideHint')}</Text>}
      </ScrollView>
      <CtaBar safeBottom={false} style={styles.cta}>
        <PrimaryButton
          label={t('record.start')}
          onPress={() =>
            router.replace({
              pathname: '/record-video',
              params: toUpload ? { mode: 'ai', next: 'upload', ...(firstTime ? { first: '1' } : {}) } : { mode: 'ai' },
            })
          }
        />
      </CtaBar>
    </SafeAreaView>
  );
}

// pen 03 「찍는 법」 — 본문 안쪽 [14,20,0,20], 그림 칸 193(#F8FAFF · 모서리 24 · 아이콘 56 · 12 띄워 18/800 진한 파랑),
// 15 띄워 체크 줄 넷(높이 55.6 · 체크 20 · 6 띄워 17/700 #333D4B), 아래 버튼 칸 [_,20,11,20].
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 24, gap: 15 },
  hero: {
    height: 193,
    borderRadius: 24,
    backgroundColor: palette.blueMist,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  heroText: { fontSize: 18, fontWeight: '800', lineHeight: 24, color: palette.blueDeep, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 55.6, paddingLeft: 3 },
  rowText: { flex: 1, fontSize: 17, fontWeight: '700', color: palette.textStrong },
  guide: { fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.blueDeep },
  cta: { paddingHorizontal: 20, paddingBottom: 11 },
});
