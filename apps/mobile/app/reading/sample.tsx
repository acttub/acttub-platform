import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { CtaBar } from '@/components/ui/cta-bar';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import { dialogueCount, SAMPLE_SCRIPTS, samplePreview, sampleById } from '@/lib/reading/sample';

/**
 * 예시 대본 고르기(pen R1.15). 대본 목록 칩으로 세 예시를 바꿔 보고, 「이 대본으로 하기」를 누르면
 * 그 대본이 채워진 대본 넣기(reading/new)로 이어 기존 저장 흐름을 탄다.
 */
export default function SampleScriptPicker() {
  const router = useRouter();
  const [pickedId, setPickedId] = useState<string>(SAMPLE_SCRIPTS[0].id);
  const entry = sampleById(pickedId);
  const preview = samplePreview(entry);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader
        title={t('reading.samplePickTitle')}
        left={<NavIconButton icon="chevron-left" size={24} label={t('common.back')} phLabel="reading_sample_back" onPress={() => router.back()} />}
      />
      <ScrollView contentContainerStyle={styles.body}>
        <MascotBubble title={t('reading.samplePickAsk')} guide={t('reading.samplePickGuide')} />
        <View style={styles.card} accessibilityLabel={entry.title}>
          <Text style={styles.cardTitle}>{entry.title}</Text>
          <Text style={styles.meta}>
            {entry.summary}
            {dialogueCount(entry) > 0 ? ` · ${t('reading.samplePickLines', { count: dialogueCount(entry) })}` : ''}
          </Text>
          {preview.map((l, i) => (
            <View key={i} style={styles.row}>
              {l.speaker ? <Text style={styles.speaker}>{l.speaker}</Text> : null}
              <Text style={styles.line}>{l.text}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.label}>{t('reading.samplePickList')}</Text>
        <View style={styles.chips}>
          {SAMPLE_SCRIPTS.map((s) => (
            <Chip key={s.id} label={s.title} role="radio" selected={pickedId === s.id} phLabel="reading_sample_chip" onPress={() => setPickedId(s.id)} />
          ))}
        </View>
      </ScrollView>
      <CtaBar>
        <PrimaryButton
          label={t('reading.samplePickConfirm')}
          phLabel="reading_sample_confirm"
          onPress={() => router.push({ pathname: '/reading/new', params: { sample: pickedId } })}
        />
      </CtaBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingTop: 15, paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  card: { gap: 8, padding: 18, borderRadius: 18, backgroundColor: palette.bgSoft },
  cardTitle: { fontSize: 20, fontWeight: '800', color: palette.text },
  meta: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  row: { gap: 2 },
  speaker: { fontSize: 12.5, fontWeight: '700', color: palette.blue },
  line: { fontSize: 15, lineHeight: 23, color: palette.text },
  label: { fontSize: 13, fontWeight: '700', color: palette.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
