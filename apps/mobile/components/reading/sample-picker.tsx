import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppDialog } from '@/components/app-dialog';
import { Chip } from '@/components/ui/chip';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { loadExamples, localExamples, type ExampleEntry, type ExampleList } from '@/lib/reading/examples';
import { isMonologue } from '@/lib/reading/monologue';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { isGroupCharacter } from '@/lib/reading/session-plan';
import { loadIntoCurrent } from '@/lib/reading/store';
import { newRequestId } from '@/lib/request-id';
import { afterVoicesSaved, currentTutorial } from '@/lib/tutorial';
import { useFirstReading } from '@/hooks/use-first-reading';
import { FIRST_READING_HREF } from '@/lib/reading/first-reading';

type Options = {
  /** 이름 없는 독백이면 이름부터 받는다(SOMA-597). */
  onNeedName: (target: { scriptId: string; characterId: string }) => void;
  /** 서버 예시를 못 받아 내장 예시를 고른 경우 — 그 글을 채운 대본 넣기로 잇는다. */
  onLocal?: (id: string) => void;
};

/**
 * 예시 대본 고르기(pen R1.15)의 상태와 「이 대본으로 하기」. 예시 대본 화면(reading/sample)과
 * 내 대본 올리기의 「대본 같이 만들기 · 예시 대본 고르기」(10/25, 화면 이동 없이 아래에 펼침)가 같이 쓴다.
 * 서버 예시는 내 대본으로 바로 복사(start)해 대본 상세로 가고, 내장 예시는 그 글이 채워진 대본 넣기로 간다.
 */
export function useSamplePicker({ onNeedName, onLocal }: Options) {
  const router = useRouter();
  const firstReading = useFirstReading();
  const firstReadingRef = useRef<boolean | null>(null);
  firstReadingRef.current = firstReading;
  const { alert, dialog } = useAppDialog();
  const [list, setList] = useState<ExampleList>(localExamples);
  const [pickedId, setPickedId] = useState<string>(() => localExamples().examples[0].id);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
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
      if (isMonologue(saved.characters) && solo[0].unnamed) return onNeedName({ scriptId: saved.id, characterId: solo[0].id });
      // 첫 리딩이면 대본 상세·구간을 건너뛰고 배역만 고른다(10/29).
      if (firstReadingRef.current) return router.replace(FIRST_READING_HREF);
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
    if (onLocal) return onLocal(entry.id);
    router.push({ pathname: '/reading/new', params: { sample: entry.id } });
  };

  return { list, entry, pick: setPickedId, busy, confirm, dialog };
}

/** 고른 예시의 미리보기 카드와 예시 고르기 칩. */
export function SamplePickerBody({ list, entry, pick }: { list: ExampleList; entry: ExampleEntry; pick: (id: string) => void }) {
  return (
    <>
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
          <Chip key={s.id} label={s.title} role="radio" selected={entry.id === s.id} phLabel="reading_sample_chip" onPress={() => pick(s.id)} />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, padding: 18, borderRadius: 18, backgroundColor: palette.bgSoft },
  cardTitle: { fontSize: 20, fontWeight: '800', color: palette.text },
  meta: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  row: { gap: 2 },
  speaker: { fontSize: 12.5, fontWeight: '700', color: palette.blue },
  line: { fontSize: 15, lineHeight: 23, color: palette.text },
  label: { fontSize: 13, fontWeight: '700', color: palette.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
