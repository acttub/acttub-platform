import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { browseFailure, browseFailureMessage, dDayLabel, participantsLabel, searchable } from '@/lib/challenge/browse';
import type { ChallengeCard } from '@/lib/challenge/types';
import { SEARCH_MIN_LENGTH } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

/**
 * A16.1 대사 검색(challenge.browse).
 *
 * 대사·작품과 공개 조건 참여작 작성자의 현재 프로필 이름만 찾는다(인물·메모는 찾지 않는다).
 * 두 글자 이상일 때만 찾고, 없으면 "직접 등록하기"로 A16.2 등록에 적은 말을 그대로 넘긴다.
 */
export default function LineSearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChallengeCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (q: string) => {
    if (!searchable(q)) {
      setResults(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.listChallenges({ tab: 'popular', q: q.trim() });
      setResults(result.challenges);
      logEvent('line_search', { length: q.trim().length, count: result.challenges.length });
    } catch (e) {
      setResults([]);
      setError(browseFailureMessage(browseFailure(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  // 입력이 멈추면 찾는다 — 글자마다 부르지 않는다.
  useEffect(() => {
    const timer = setTimeout(() => void search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  const register = () => router.push({ pathname: '/line-new', params: { line: query.trim() } });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('lineSearch.title')}</Text>
        <View style={styles.flex} />
        <Pressable onPress={register} hitSlop={10} accessibilityRole="button">
          <Feather name="plus" size={26} color={palette.blue} />
        </Pressable>
      </View>

      <View style={styles.searchBox}>
        <Feather name="search" size={16} color={palette.textFaint} />
        <TextInput
          style={styles.input}
          placeholder={t('lineSearch.placeholder')}
          placeholderTextColor={palette.textFaint}
          value={query}
          onChangeText={setQuery}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => void search(query)}
        />
        {!!query && (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button">
            <Feather name="x" size={16} color={palette.textFaint} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!searchable(query) && <Text style={styles.hint}>{t('lineSearch.minLength', { count: SEARCH_MIN_LENGTH })}</Text>}
        {loading && <ActivityIndicator color={palette.blue} style={{ marginTop: 24 }} />}
        {error && <Text style={styles.error}>{error}</Text>}

        {results?.map((challenge) => (
          <Pressable
            key={challenge.id}
            style={styles.row}
            onPress={() => router.push({ pathname: '/challenge-detail', params: { id: challenge.id } })}
            accessibilityRole="button">
            <View style={styles.rowBody}>
              <Text style={styles.rowLine} numberOfLines={2}>
                “{challenge.line}”
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {challenge.work} · {t('challenges.entryCount', { count: challenge.entry_count })} · {dDayLabel(challenge)}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {participantsLabel(challenge.participants, challenge.more_count)}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={palette.checkOff} />
          </Pressable>
        ))}

        {results !== null && results.length === 0 && !loading && !error && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('lineSearch.empty')}</Text>
            <Pressable style={styles.registerBtn} onPress={register} accessibilityRole="button">
              <Feather name="plus" size={15} color={palette.blue} />
              <Text style={styles.registerText}>{t('lineSearch.registerCta')}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  title: { fontSize: 18, fontWeight: '800', color: palette.text },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
  },
  input: { flex: 1, fontSize: 15, color: palette.text },
  body: { padding: 16, paddingBottom: 60, gap: 4 },
  hint: { fontSize: 13, color: palette.textFaint, paddingVertical: 12 },
  error: { color: palette.danger, fontSize: 13.5, fontWeight: '700', paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  rowBody: { flex: 1, gap: 4 },
  rowLine: { fontSize: 15, fontWeight: '700', color: palette.text, lineHeight: 23 },
  rowMeta: { fontSize: 12, color: palette.textFaint },
  empty: { alignItems: 'center', gap: 14, paddingVertical: 40 },
  emptyText: { fontSize: 14.5, color: palette.textDim },
  registerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.blueSoft,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  registerText: { fontSize: 14, fontWeight: '800', color: palette.blue },
});
