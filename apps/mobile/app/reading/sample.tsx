import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MonologueNameDialog } from '@/components/ds/monologue-name-dialog';
import { SamplePickerBody, useSamplePicker } from '@/components/ds/reading/sample-picker';
import { PrimaryButton } from '@/components/ds/ui/buttons';
import { CtaBar } from '@/components/ds/ui/cta-bar';
import { MascotBubble } from '@/components/ds/ui/mascot-bubble';
import { NavBackButton, NavHeader } from '@/components/ds/ui/nav-header';
import { palette } from '@/constants/palette';
import { space } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

/**
 * 예시 대본 고르기(pen R1.15). 목록·「이 대본으로 하기」는 components/reading/sample-picker 와 같다 —
 * 내 대본 올리기의 「대본 같이 만들기」(10/25)도 같은 부품을 화면 안에 펼쳐 쓴다.
 */
export default function SampleScriptPicker() {
  const router = useRouter();
  const [naming, setNaming] = useState<{ scriptId: string; characterId: string } | null>(null);
  // 입시 준비 배우의 가입 직후·실기 알림은 ?exam=1 로 온다(SOMA-864).
  const exam = useLocalSearchParams<{ exam?: string }>().exam === '1';
  const picker = useSamplePicker({ onNeedName: setNaming, exam });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader
        title={t('reading.samplePickTitle')}
        left={<NavBackButton phLabel="reading_sample_back" onPress={() => router.back()} />}
      />
      <ScrollView contentContainerStyle={styles.body}>
        <MascotBubble title={t('reading.samplePickAsk')} guide={t('reading.samplePickGuide')} />
        <SamplePickerBody list={picker.list} entry={picker.entry} pick={picker.pick} />
      </ScrollView>
      <CtaBar>
        <PrimaryButton
          label={t('reading.samplePickConfirm')}
          phLabel="reading_sample_confirm"
          loading={picker.busy}
          loadingLabel={t('loadingText.preparing')}
          onPress={picker.confirm}
        />
      </CtaBar>
      <MonologueNameDialog
        target={naming}
        onClose={() => {
          setNaming(null);
          router.replace('/reading/detail');
        }}
      />
      {picker.dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingTop: space[4], paddingHorizontal: space.gutter, paddingBottom: space[6], gap: space[4] },
});
