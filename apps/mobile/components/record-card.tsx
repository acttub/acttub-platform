import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ReportRecord } from '@/lib/api';
import { formatKoreanDateTime } from '@/lib/format';
import { palette } from '@/constants/palette';

export type RecordMeta = { dimension: string; start: string; end: string };

/** 리포트 상세의 진단 축(dimension)에서 카드 태그칩을 만든다. (시간구간은 칩에 넣지 않음) */
export function recordChips(m?: RecordMeta): string[] {
  if (!m) return [];
  return (m.dimension || '')
    .split(/[/·,、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 연습 기록 카드 — 홈 '최근 연습'과 기록 탭에서 공용으로 쓴다.
 * 삼성 녹음기 스타일: eyebrow · 굵은 날짜제목 · 서브 · 태그칩 · (선택)메뉴.
 */
export function RecordCard({
  item,
  meta,
  onPress,
  onMenu,
  preview,
}: {
  item: ReportRecord;
  meta?: RecordMeta;
  onPress: () => void;
  onMenu?: () => void;
  /** 홈 '최근 연습' 미리보기에서는 타임스탬프를 숨긴다. */
  preview?: boolean;
}) {
  const chips = recordChips(meta);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Pressable style={styles.cardTextArea} onPress={onPress}>
          <View style={styles.eyebrowRow}>
            <Feather name="activity" size={15} color={palette.textFaint} />
            <Text style={styles.eyebrow}>연습 피드백</Text>
          </View>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.headline}
          </Text>
          {!preview && <Text style={styles.timestamp}>{formatKoreanDateTime(item.created_at)}</Text>}
        </Pressable>
        {!!onMenu && (
          <Pressable hitSlop={8} style={styles.menuBtn} onPress={onMenu}>
            <Feather name="more-vertical" size={20} color={palette.textFaint} />
          </Pressable>
        )}
      </View>

      {chips.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}>
          {chips.map((c, i) => (
            <View key={`${c}-${i}`} style={styles.chip}>
              <Text style={styles.chipText}>{c}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.card,
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
    // shadow*는 iOS 전용(원래 값 유지), elevation은 Android 전용(진해서 낮춤)
    shadowColor: '#191F28',
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  cardTextArea: { flex: 1 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  eyebrow: { fontSize: 13, fontWeight: '500', color: palette.textFaint },
  cardTitle: { fontSize: 16, fontWeight: '500', color: palette.text, lineHeight: 24 },
  timestamp: { fontSize: 13, fontWeight: '400', color: palette.textFaint, marginTop: 6 },
  menuBtn: { padding: 2, marginLeft: 8 },
  chipRow: { gap: 8, paddingTop: 14, paddingRight: 8 },
  chip: {
    backgroundColor: palette.bgSoft,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: { fontSize: 14, fontWeight: '400', color: palette.textDim },
});
