import Feather from '@expo/vector-icons/Feather';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { translate as t } from '@/lib/i18n';
import { noteRatings } from '@/lib/note-rating';
import { buildNoteRatingBody, NOTE_RATING_COMMENT_MAX, noteRatingCommentText } from '@/lib/practice/note-rating';
import type { NoteRating, NoteRatingValue } from '@/lib/practice/types';
import { newRequestId } from '@/lib/request-id';

/**
 * 연습 노트 맨 아래 평가(practice.note) — 칩을 누르는 순간 서버에 노트 단위로 저장한다(낙관적 표시).
 * 한 줄은 선택이고, 보내면 같은 평가에 덧붙는다. 못 보낸 요청은 기기가 같은 요청 id 로 들고 있다가
 * 다시 보낸다(lib/note-rating.ts). 초기값은 노트 조회의 my_rating 이다. 이탈 설문과 다른 기능이다.
 */
export function ReportRating({ practiceId, initial }: { practiceId: string; initial: NoteRating | null | undefined }) {
  const [rating, setRating] = useState<NoteRatingValue | null>(initial?.rating ?? null);
  // 서버에 붙어 있는(또는 보내는 중인) 한 줄. 칩을 바꿔도 이 한 줄은 그대로 함께 보낸다.
  const [comment, setComment] = useState<string | null>(initial?.comment ?? null);
  const [draft, setDraft] = useState(initial?.comment ?? '');
  const [thanked, setThanked] = useState(false);
  // 겹쳐 누른 칩의 늦은 실패가 나중 선택을 되돌리지 않게, 마지막 요청만 화면을 바꾼다.
  const latest = useRef<string | null>(null);

  const save = async (next: NoteRatingValue, nextComment: string | null, previous: { rating: NoteRatingValue | null; comment: string | null }) => {
    const requestId = newRequestId();
    latest.current = requestId;
    const result = await noteRatings.send(practiceId, buildNoteRatingBody({ requestId, rating: next, comment: nextComment }));
    void logEvent('report_rating_submit', { rating: next, length: nextComment?.length ?? 0, result });
    // 4xx 는 다시 보내도 소용없다 — 저장되지 않은 선택을 보여 두지 않는다.
    if (result === 'dropped' && latest.current === requestId) {
      setRating(previous.rating);
      setComment(previous.comment);
      setThanked(false);
    }
  };

  const choose = (next: NoteRatingValue) => {
    if (next === rating) return;
    const previous = { rating, comment };
    setRating(next);
    void save(next, comment, previous);
  };

  const send = () => {
    if (!rating) return;
    const text = noteRatingCommentText(draft);
    const previous = { rating, comment };
    setComment(text);
    setThanked(true);
    void save(rating, text, previous);
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('report.rateTitle')}</Text>
      <View style={styles.row}>
        {(
          [
            ['helpful', 'thumbs-up', 'report.rateGood'],
            ['not_helpful', 'thumbs-down', 'report.rateBad'],
          ] as const
        ).map(([key, icon, label]) => (
          <Pressable
            key={key}
            style={[styles.chip, rating === key && styles.chipOn]}
            onPress={() => choose(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: rating === key }}>
            <Feather name={icon} size={15} color={rating === key ? palette.blueDeep : palette.textDim} />
            <Text style={[styles.chipText, rating === key && styles.chipTextOn]}>{t(label)}</Text>
          </Pressable>
        ))}
      </View>
      {rating && thanked && <Text style={styles.thanks}>{t('report.rateThanks')}</Text>}
      {rating && !thanked && (
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={t('report.ratePh')}
            placeholderTextColor={palette.textFaint}
            maxLength={NOTE_RATING_COMMENT_MAX}
          />
          <Pressable style={styles.send} onPress={send} accessibilityRole="button">
            <Text style={styles.sendText}>{t('report.rateSend')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: palette.bgSubtle, borderRadius: 16, padding: 16, gap: 10 },
  title: { fontSize: 14, fontWeight: '800', color: palette.text },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  chipText: { fontSize: 13.5, fontWeight: '700', color: palette.textDim },
  chipTextOn: { color: palette.blueDeep },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: palette.text,
  },
  send: { backgroundColor: palette.blue, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 },
  sendText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  thanks: { fontSize: 14, fontWeight: '700', color: palette.blueDeep },
});
