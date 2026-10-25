import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { MonologueNameDialog } from '@/components/monologue-name-dialog';
import { PrimaryButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { CtaBar } from '@/components/ui/cta-bar';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { loadExamples, localExamples, type ExampleList } from '@/lib/reading/examples';
import { isMonologue } from '@/lib/reading/monologue';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { isGroupCharacter } from '@/lib/reading/session-plan';
import { loadIntoCurrent } from '@/lib/reading/store';
import { newRequestId } from '@/lib/request-id';
import { afterVoicesSaved, currentTutorial } from '@/lib/tutorial';

/**
 * 예시 대본 고르기(pen R1.15). 목록은 서버가 미리 나눠 둔 예시이고, 받는 동안·못 받으면 앱에 내장된 예시를 보여 준다.
 * 「이 대본으로 하기」 — 서버 예시는 내 대본으로 바로 복사(start)해 대본 넣기 끝과 같은 대본 상세로 가고, 내장 예시는
 * 그 글이 채워진 대본 넣기(reading/new)로 이어 기존 저장 흐름을 탄다.
 */
export default function SampleScriptPicker() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const [list, setList] = useState<ExampleList>(localExamples);
  const [pickedId, setPickedId] = useState<string>(() => localExamples().examples[0].id);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [naming, setNaming] = useState<{ scriptId: string; characterId: string } | null>(null);
  /** 예시마다 한 요청 id — 실패 뒤 다시 눌러도 같은 id 라 서버에 대본이 둘 생기지 않는다. */
  const requestIds = useRef<Record<string, string>>({});
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void loadExamples(() => api.listReadingExamples()).then((next) => {
      if (!alive.current) return;
      setList(next);
      setPickedId((id) => (next.examples.some((e) => e.id === id) ? id : next.examples[0].id));
    });
    return () => {
      alive.current = false;
    };
  }, []);

  const entry = list.examples.find((e) => e.id === pickedId) ?? list.examples[0];

  const fail = (message: string) => void alert({ title: t('common.save'), message });

  const startFromServer = async (id: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const requestId = (requestIds.current[id] ??= newRequestId());
      const { script_id } = await api.startReadingExample(id, { request_id: requestId });
      const saved = await loadIntoCurrent(script_id);
      if (!alive.current) return;
      if (!saved) return fail(t('errors.network'));
      // 대본 넣기 끝과 같은 길 — 이름 없는 독백은 이름부터, 아니면 대본 상세(SOMA-597).
      const solo = saved.characters.filter((c) => !isGroupCharacter(c));
      if (isMonologue(saved.characters) && solo[0].unnamed) return setNaming({ scriptId: saved.id, characterId: solo[0].id });
      router.replace('/reading/detail');
      if (afterVoicesSaved(true, currentTutorial()) === 'detail_then_range') router.push('/reading/range');
    } catch (error) {
      if (alive.current) fail(scriptErrorMessage(error));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const confirm = () => {
    if (list.source === 'server') return void startFromServer(entry.id);
    router.push({ pathname: '/reading/new', params: { sample: entry.id } });
  };

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
            {entry.dialogueCount > 0 ? ` · ${t('reading.samplePickLines', { count: entry.dialogueCount })}` : ''}
          </Text>
          {entry.preview.map((l, i) => (
            <View key={i} style={styles.row}>
              {l.speaker ? <Text style={styles.speaker}>{l.speaker}</Text> : null}
              <Text style={styles.line}>{l.text}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.label}>{t('reading.samplePickList')}</Text>
        <View style={styles.chips}>
          {list.examples.map((s) => (
            <Chip key={s.id} label={s.title} role="radio" selected={entry.id === s.id} phLabel="reading_sample_chip" onPress={() => setPickedId(s.id)} />
          ))}
        </View>
      </ScrollView>
      <CtaBar>
        <PrimaryButton
          label={t('reading.samplePickConfirm')}
          phLabel="reading_sample_confirm"
          loading={busy}
          onPress={confirm}
        />
      </CtaBar>
      <MonologueNameDialog
        target={naming}
        onClose={() => {
          setNaming(null);
          router.replace('/reading/detail');
        }}
      />
      {dialog}
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
