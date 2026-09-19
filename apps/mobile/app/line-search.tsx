import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { ALL_LINES } from '@/lib/challenge-mock';
import { translate as t } from '@/lib/i18n';

type Filter = 'challenge' | 'popular' | 'latest';

/**
 * A16.1 대사 검색 — 챌린지 탭 검색창이 온다. 예시 대사 풀(challenge-mock)에서 대사·작품으로
 * 찾고, 없으면 "직접 등록하기"로 A16.2 등록 위저드에 보낸다.
 */
export default function LineSearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('challenge');

  const results = useMemo(() => {
    const q = query.trim().replace(/\s+/g, '');
    if (!q) return ALL_LINES;
    return ALL_LINES.filter((l) => (l.line + l.work).replace(/\s+/g, '').includes(q));
  }, [query]);

  const open = (line: string, work: string) => {
    logEvent('line_search_open', { line: line.slice(0, 40) });
    router.push({ pathname: '/challenge-detail', params: { line, work } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('lineSearch.title')}</Text>
        <View style={styles.flex} />
        <Pressable onPress={() => router.push('/line-new')} hitSlop={10} accessibilityRole="button">
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
        />
        {!!query && (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button">
            <Feather name="x-circle" size={16} color={palette.checkOff} />
          </Pressable>
        )}
      </View>

      <View style={styles.filters}>
        {(
          [
            ['challenge', 'lineSearch.filterChallenge'],
            ['popular', 'lineSearch.filterPopular'],
            ['latest', 'lineSearch.filterLatest'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.chip, filter === key && styles.chipOn]}
            onPress={() => setFilter(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === key }}>
            <Text style={[styles.chipText, filter === key && styles.chipTextOn]}>{t(label)}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {results.length === 0 ? (
          <Text style={styles.empty}>{t('lineSearch.empty')}</Text>
        ) : (
          results.map((item) => (
            <Pressable
              key={item.line}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => open(item.line, item.work)}
              accessibilityRole="button">
              <View style={styles.flex}>
                <Text style={styles.rowLine} numberOfLines={1}>“{item.line}”</Text>
                <Text style={styles.rowWork}>{item.work}</Text>
              </View>
              <View style={styles.likeChip}>
                <Feather name="heart" size={13} color={palette.textFaint} />
                <Text style={styles.likeText}>{item.likes}</Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <Pressable
        style={({ pressed }) => [styles.registerBtn, pressed && styles.pressed]}
        onPress={() => router.push({ pathname: '/line-new', params: { line: query.trim() } })}
        accessibilityRole="button">
        <Feather name="plus" size={15} color={palette.blue} />
        <Text style={styles.registerText}>{t('lineSearch.registerCta')}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: palette.text },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    borderWidth: 1.5,
    borderColor: palette.blue,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
  },
  input: { flex: 1, fontSize: 15, color: palette.text },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 12 },
  chip: { borderRadius: 999, backgroundColor: palette.bgSoft, paddingHorizontal: 14, paddingVertical: 7 },
  chipOn: { backgroundColor: palette.blue },
  chipText: { fontSize: 13, fontWeight: '700', color: palette.textFaint },
  chipTextOn: { color: '#FFFFFF' },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, flexGrow: 1 },
  empty: { textAlign: 'center', color: palette.textFaint, marginTop: 80, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: palette.borderSoft },
  rowLine: { fontSize: 14.5, fontWeight: '700', color: palette.text },
  rowWork: { fontSize: 12, color: palette.textFaint, marginTop: 3 },
  likeChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  likeText: { fontSize: 12, fontWeight: '700', color: palette.textFaint },
  registerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bgSubtle,
    borderRadius: 14,
    paddingVertical: 15,
  },
  registerText: { fontSize: 14, fontWeight: '800', color: palette.blue },
});
