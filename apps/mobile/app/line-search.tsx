import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { Button } from '@/components/ui/buttons';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError } from '@/components/ui/inline-error';
import { NavBackButton, NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { browseFailure, browseFailureMessage, dDayLabel, participantsLabel, searchable } from '@/lib/challenge/browse';
import type { ChallengeCard } from '@/lib/challenge/types';
import { SEARCH_MIN_LENGTH } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';
import { SkeletonRows } from '@/components/ui/skeleton';

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
  const [focused, setFocused] = useState(false);

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
      <NavHeader
        title={t('lineSearch.title')}
        left={<NavBackButton phLabel="line_search_back" onPress={() => router.back()} />}
        right={<NavIconButton icon="plus" label={t('challenges.addLine')} phLabel="line_search_add" onPress={register} />}
      />

      <View style={[styles.searchBox, focused && styles.searchBoxFocus]}>
        <Feather name="search" size={18} color={palette.iconFaint} />
        <TextInput
          style={styles.input}
          placeholder={t('lineSearch.placeholder')}
          placeholderTextColor={palette.textMeta}
          value={query}
          onChangeText={setQuery}
          autoFocus
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          returnKeyType="search"
          onSubmitEditing={() => void search(query)}
        />
        {!!query && (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.delete')} ph-label="line_search_clear">
            <Feather name="x" size={18} color={palette.iconFaint} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <AdSlot slot="line_search_top" style={styles.ad} />
        {!searchable(query) && <Text style={styles.hint}>{t('lineSearch.minLength', { count: SEARCH_MIN_LENGTH })}</Text>}
        {loading && !results?.length && <SkeletonRows count={4} avatar={false} card={false} style={styles.skeleton} />}
        {error && <InlineError message={error} onRetry={() => void search(query)} />}

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
            <Feather name="chevron-right" size={18} color={palette.iconFaint} />
          </Pressable>
        ))}

        {results !== null && results.length === 0 && !loading && !error && (
          <View style={styles.empty}>
            <InlineEmpty title={t('lineSearch.empty')} description={t('lineSearch.emptySub')} />
            <Button
              size="sm"
              label={t('lineSearch.registerCta')}
              icon={<Feather name="plus" size={16} color={palette.blueDeep} />}
              onPress={register}
              phLabel="line_search_register"
              style={styles.register}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginHorizontal: space.gutter,
    marginTop: space[2],
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    height: 48,
  },
  // 테두리가 0.5 두꺼워진 만큼 안쪽을 줄여 칸 크기가 그대로다.
  searchBoxFocus: { borderWidth: 1.5, borderColor: palette.blue, paddingHorizontal: space[4] - 0.5 },
  input: { ...type.body1, lineHeight: undefined, flex: 1, color: palette.text, padding: 0 },
  body: { paddingHorizontal: space.gutter, paddingTop: space[4], paddingBottom: space[10], gap: space[1] },
  ad: { marginBottom: space[3] },
  skeleton: { paddingHorizontal: 0 },
  hint: { ...type.caption, color: palette.textMeta },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  rowBody: { flex: 1, gap: space[1] },
  rowLine: { ...type.body1Bold, color: palette.text },
  rowMeta: { ...type.caption, color: palette.textMeta },
  empty: { gap: space[3] },
  register: { height: 48 },
});
