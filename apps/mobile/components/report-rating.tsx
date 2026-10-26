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
  return (
    <RatingBox<NoteRatingValue>
      initial={initial ?? null}
      title={t('report.rateTitle')}
      options={[
        ['helpful', 'thumbs-up', t('report.rateGood')],
        ['not_helpful', 'thumbs-down', t('report.rateBad')],
      ]}
      placeholder={t('report.ratePh')}
      sendLabel={t('report.rateSend')}
      thanks={t('report.rateThanks')}
      commentMax={NOTE_RATING_COMMENT_MAX}
      save={async (requestId, rating, comment) => {
        const result = await noteRatings.send(practiceId, buildNoteRatingBody({ requestId, rating, comment }));
        void logEvent('report_rating_submit', { rating, length: comment?.length ?? 0, result });
        return result;
      }}
    />
  );
}

/**
 * 칩 둘 + 선택 한 줄 평가 상자. 칩을 누르는 순간 저장하고(낙관적 표시), 한 줄은 보내면 같은 평가에 덧붙는다.
 * 저장이 4xx 로 버려지면 앞 선택으로 되돌린다. 노트 평가와 리딩 평가(components/reading-rating)가 같이 쓴다.
 */
export function RatingBox<Value extends string>({
  initial,
  title,
  options,
  placeholder,
  sendLabel,
  thanks,
  commentMax,
  save: persist,
  onInputFocus,
}: {
  initial: { rating: Value; comment: string | null } | null;
  title: string;
  options: readonly (readonly [Value, 'thumbs-up' | 'thumbs-down', string])[];
  placeholder: string;
  sendLabel: string;
  thanks: string;
  commentMax: number;
  save: (requestId: string, rating: Value, comment: string | null) => Promise<'sent' | 'queued' | 'dropped'>;
  /** 한 줄 칸을 눌렀을 때 — 부른 화면이 칸을 키보드 위로 올린다. */
  onInputFocus?: () => void;
}) {
  const [rating, setRating] = useState<Value | null>(initial?.rating ?? null);
  // 서버에 붙어 있는(또는 보내는 중인) 한 줄. 칩을 바꿔도 이 한 줄은 그대로 함께 보낸다.
  const [comment, setComment] = useState<string | null>(initial?.comment ?? null);
  const [draft, setDraft] = useState(initial?.comment ?? '');
  const [thanked, setThanked] = useState(false);
  // 겹쳐 누른 칩의 늦은 실패가 나중 선택을 되돌리지 않게, 마지막 요청만 화면을 바꾼다.
  const latest = useRef<string | null>(null);

  const save = async (next: Value, nextComment: string | null, previous: { rating: Value | null; comment: string | null }) => {
    const requestId = newRequestId();
    latest.current = requestId;
    const result = await persist(requestId, next, nextComment);
    // 4xx 는 다시 보내도 소용없다 — 저장되지 않은 선택을 보여 두지 않는다.
    if (result === 'dropped' && latest.current === requestId) {
      setRating(previous.rating);
      setComment(previous.comment);
      setThanked(false);
    }
  };

  const choose = (next: Value) => {
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
      <Text style={styles.title}>{title}</Text>
      <View style={styles.row}>
        {options.map(([key, icon, label]) => (
          <Pressable
            key={key}
            style={[styles.chip, rating === key && styles.chipOn]}
            onPress={() => choose(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: rating === key }}>
            <Feather name={icon} size={15} color={rating === key ? palette.blueDeep : palette.textDim} />
            <Text style={[styles.chipText, rating === key && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {rating && thanked && <Text style={styles.thanks}>{thanks}</Text>}
      {rating && !thanked && (
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={palette.textFaint}
            maxLength={commentMax}
            onFocus={onInputFocus}
          />
          <Pressable style={styles.send} onPress={send} accessibilityRole="button">
            <Text style={styles.sendText}>{sendLabel}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // pen 「배우 일지」 평가 줄(SOMA-770) — 바탕 카드 없이 제목 14/800 + 회색 알약 칩(안쪽 10·16, 글 15/700).
  box: { gap: 10 },
  title: { fontSize: 14, fontWeight: '800', lineHeight: 21, color: palette.text },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: palette.bgSoft,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chipOn: { backgroundColor: palette.blueSoft },
  chipText: { fontSize: 15, fontWeight: '700', color: palette.textDim },
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
