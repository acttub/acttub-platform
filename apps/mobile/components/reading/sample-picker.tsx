import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppDialog } from '@/components/app-dialog';
import { Chip } from '@/components/ui/chip';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { loadExamples, localExamples, type ExampleEntry, type ExampleList } from '@/lib/reading/examples';
import { isMonologue } from '@/lib/reading/monologue';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { isGroupCharacter } from '@/lib/reading/session-plan';
import { loadIntoCurrent } from '@/lib/reading/store';
import { newRequestId } from '@/lib/request-id';
import { afterVoicesSaved, currentTutorial } from '@/lib/tutorial';

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

  const fail = (message: string) => void alert({ title: t('reading.sampleOpenFailTitle'), message });

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

/**
 * 고른 예시의 미리보기와 예시 고르기 칩. 예시 대본 화면은 테두리 카드 아래 「예시 대본」 칩 줄(pen reading-sample.server),
 * 새 대본 안에 펼칠 때는 칩 줄 아래 bg-subtle 미리보기(pen reading-new.make-sample)다.
 */
export function SamplePickerBody({
  list,
  entry,
  pick,
  inline = false,
}: {
  list: ExampleList;
  entry: ExampleEntry;
  pick: (id: string) => void;
  inline?: boolean;
}) {
  const lead = entry.preview.find((l) => l.speaker)?.speaker;
  const preview = (
    <View style={[styles.card, inline ? styles.cardInline : styles.cardBordered]} accessibilityLabel={entry.title}>
      <Text style={styles.cardTitle}>{entry.title}</Text>
      <Text style={styles.meta}>
        {entry.summary}
        {entry.dialogueCount > 0 ? ` · ${t('reading.samplePickLines', { count: entry.dialogueCount })}` : ''}
      </Text>
      {entry.preview.map((l, i) => (
        <View key={i} style={styles.row}>
          {l.speaker ? <Text style={[styles.speaker, l.speaker === lead && styles.speakerLead]}>{l.speaker}</Text> : null}
          <Text style={[styles.line, !l.speaker && styles.direction]}>{l.text}</Text>
        </View>
      ))}
    </View>
  );
  const chips = (
    <View style={styles.chips}>
      {list.examples.map((s) => (
        <Chip key={s.id} label={s.title} role="radio" selected={entry.id === s.id} phLabel="reading_sample_chip" onPress={() => pick(s.id)} />
      ))}
    </View>
  );
  return inline ? (
    <>
      {chips}
      {preview}
    </>
  ) : (
    <>
      {preview}
      <Text style={styles.label}>{t('reading.samplePickList')}</Text>
      {chips}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[2], padding: space[4], borderRadius: radius.lg },
  cardBordered: { backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border },
  cardInline: { backgroundColor: palette.bgSubtle },
  cardTitle: { ...type.headline, color: palette.text },
  meta: { ...type.caption, color: palette.textMeta },
  row: { flexDirection: 'row', gap: space[3] },
  speaker: { ...type.body2Bold, width: 32, color: palette.text },
  speakerLead: { color: palette.blueDeep },
  line: { ...type.body2, flex: 1, color: palette.text },
  direction: { color: palette.textMeta },
  label: { ...type.body2Bold, color: palette.textSub },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
