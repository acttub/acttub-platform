import { AccountContent } from '@/components/account-content';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { dismissLegacyScriptNotice, readLegacyScriptNotice } from '@/lib/reading/legacy-migration-runner';
import type { LegacyNotice } from '@/lib/reading/legacy-migration';
import { cardMeta, lastActivityLabel, listHeader, myCharactersLabel, statusChip } from '@/lib/reading/script-cards';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { deleteScript, listScripts, loadIntoCurrent } from '@/lib/reading/store';
import type { ScriptCard, ScriptCardStatus, ScriptListResponse } from '@/lib/reading/types';
import { translate as t } from '@/lib/i18n';

/**
 * 내 대본 목록(R00, reading.script). 서버 목록이 정본이다 — 최근 고친 순, 머리 "전체 N개 · 연습 중 M개",
 * 카드마다 제목·내 배역·대사 수·녹음 수·마지막 활동·상태 칩(연습 중·연습 완료·배역 선택). 검색은 서버가
 * 제목과 배역 이름만 찾는다. "분석 완료" 칩은 리딩에 분석이 없어 없다.
 */
const SEARCH_DEBOUNCE_MS = 300;

const CHIP_TONE: Record<ScriptCardStatus, { color: string; bg: string }> = {
  reading: { color: palette.blue, bg: palette.blueSoft },
  completed: { color: palette.green, bg: palette.greenSoft },
  no_cast: { color: palette.textDim, bg: palette.bgSoft },
};

export default function ReadingList() {
  return <AccountContent><ReadingListContent /></AccountContent>;
}

function ReadingListContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { confirm, sheet, alert, dialog } = useAppDialog();
  const [list, setList] = useState<ScriptListResponse | null>(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<LegacyNotice | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (keyword: string) => {
    const mine = ++generation.current;
    setError(null);
    try {
      const next = await listScripts(keyword);
      if (mine === generation.current) setList(next);
    } catch (e) {
      if (mine === generation.current) setError(scriptErrorMessage(e));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(q);
      void readLegacyScriptNotice().then(setNotice).catch(() => undefined);
      return () => {
        generation.current += 1;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  // 검색어는 잠깐 기다렸다가 서버에 묻는다(제목·배역 이름만). 처음 그릴 때는 포커스 로드가 맡는다.
  const searchedOnce = useRef(false);
  useEffect(() => {
    if (!searchedOnce.current) {
      searchedOnce.current = true;
      return;
    }
    const timer = setTimeout(() => void load(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, load]);

  const open = async (s: ScriptCard) => {
    const opened = await loadIntoCurrent(s.id);
    if (!opened) {
      void load(q);
      return;
    }
    router.push(s.my_character_names.length === 0 ? '/reading/roles' : '/reading/detail');
  };
  const memorize = async (s: ScriptCard) => {
    if (await loadIntoCurrent(s.id)) router.push('/reading/memorize');
  };
  const edit = async (s: ScriptCard) => {
    if (await loadIntoCurrent(s.id)) router.push('/reading/edit');
  };
  const remove = async (s: ScriptCard) => {
    const ok = await confirm({
      title: t('reading.deleteTitle'),
      message: s.recording_count > 0 ? t('reading.deleteBody', { recordings: s.recording_count }) : t('reading.deleteBodyNoRecordings'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteScript(s.id);
    } catch (e) {
      void alert({ title: t('reading.deleteAction'), message: scriptErrorMessage(e) });
    }
    void load(q);
  };
  const more = (s: ScriptCard) =>
    void sheet({
      title: s.title,
      actions: [
        { label: t('reading.editAction'), onPress: () => void edit(s) },
        { label: t('reading.deleteAction'), destructive: true, onPress: () => void remove(s) },
      ],
    });
  const closeNotice = () => {
    setNotice(null);
    void dismissLegacyScriptNotice().catch(() => undefined);
  };

  const scripts = list?.scripts ?? [];
  const searching = q.trim().length > 0;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}
      keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>내 대본</Text>

      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Feather name="search" size={16} color={palette.textFaint} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder={t('reading.searchPlaceholder')}
            placeholderTextColor={palette.textFaint}
          />
        </View>
        <Pressable style={styles.newBtn} onPress={() => router.push('/reading/new')}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={styles.newText}>새 대본</Text>
        </Pressable>
      </View>

      {notice && (
        <View style={styles.notice}>
          <View style={styles.noticeHead}>
            <Text style={styles.noticeTitle}>{t('reading.legacyNoticeTitle')}</Text>
            <Pressable onPress={closeNotice} hitSlop={8} accessibilityLabel={t('common.close')}>
              <Feather name="x" size={16} color={palette.textDim} />
            </Pressable>
          </View>
          {notice.moved > 0 && <Text style={styles.noticeLine}>{t('reading.legacyMoved', { count: notice.moved })}</Text>}
          {notice.memorized > 0 && <Text style={styles.noticeLine}>{t('reading.legacyMemorized', { count: notice.memorized })}</Text>}
          {notice.limited > 0 && <Text style={styles.noticeLine}>{t('reading.legacyLimited', { count: notice.limited })}</Text>}
          {notice.failed > 0 && <Text style={styles.noticeLine}>{t('reading.legacyFailed', { count: notice.failed })}</Text>}
          <Text style={styles.noticeLine}>{t('reading.legacyRecordingsNote')}</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{t('reading.listLoadFail')}</Text>
          <Pressable onPress={() => void load(q)}>
            <Text style={styles.retry}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      )}

      {list && (scripts.length > 0 || searching) && (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>업로드한 대본</Text>
          <Text style={styles.sectionCount}>{listHeader(list)}</Text>
        </View>
      )}

      {loading && !list ? (
        <View style={styles.empty}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : list && scripts.length === 0 && !searching ? (
        <View style={styles.empty}>
          <Feather name="book-open" size={34} color={palette.checkOff} />
          <Text style={styles.emptyTitle}>아직 대본이 없어요</Text>
          <Text style={styles.emptySub}>대본을 넣으면 상대 배역을 앱이 읽어줘요. 새 대본으로 시작해요.</Text>
          <Pressable style={styles.emptyBtn} onPress={() => router.push('/reading/new')}>
            <Feather name="plus" size={16} color="#fff" />
            <Text style={styles.newText}>새 대본</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {scripts.map((s) => {
            const chip = statusChip(s);
            const tone = CHIP_TONE[chip.tone];
            const activity = lastActivityLabel(s);
            return (
              <Pressable key={s.id} style={styles.card} onPress={() => void open(s)} onLongPress={() => more(s)}>
                <View style={styles.cardIcon}>
                  <Feather name="file-text" size={18} color={palette.blue} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{s.title}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {myCharactersLabel(s)} · {cardMeta(s)}
                  </Text>
                  {!!activity && <Text style={styles.cardActivity}>{activity}</Text>}
                </View>
                <View style={styles.cardRight}>
                  <View style={styles.cardRightTop}>
                    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
                      <Text style={[styles.pillText, { color: tone.color }]}>{chip.label}</Text>
                    </View>
                    <Pressable style={styles.moreBtn} hitSlop={8} accessibilityLabel={t('reading.more')} onPress={() => more(s)}>
                      <Feather name="more-horizontal" size={18} color={palette.textDim} />
                    </Pressable>
                  </View>
                  {s.my_character_names.length > 0 && (
                    <Pressable style={styles.memoChip} onPress={() => void memorize(s)}>
                      <Feather name="edit-3" size={12} color={palette.blueDeep} />
                      <Text style={styles.memoChipText}>암기</Text>
                    </Pressable>
                  )}
                </View>
              </Pressable>
            );
          })}
          {scripts.length === 0 && searching && <Text style={styles.noMatch}>검색 결과가 없어요.</Text>}
        </View>
      )}
      {dialog}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  content: { padding: 20, paddingTop: 64, gap: 14 },
  h1: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 26 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.bgSoft, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  searchInput: { flex: 1, color: palette.text, fontFamily: 'Pretendard', fontSize: 14, padding: 0 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.blue, borderRadius: 12, paddingHorizontal: 14, height: 46 },
  newText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  notice: { backgroundColor: palette.blueMist, borderColor: palette.blueLine, borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  noticeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  noticeTitle: { color: palette.blueDeep, fontFamily: 'Pretendard-Bold', fontSize: 14, flex: 1 },
  noticeLine: { color: palette.textDim, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 19 },
  errorBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.dangerSoft, borderRadius: 12, padding: 12 },
  errorText: { color: palette.danger, fontFamily: 'Pretendard', fontSize: 13 },
  retry: { color: palette.danger, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  sectionCount: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 60 },
  emptyTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 17, marginTop: 6 },
  emptySub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.blue, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12, marginTop: 8 },
  list: { gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 14, padding: 14 },
  cardIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  cardMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  cardActivity: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 12 },
  cardRight: { alignItems: 'flex-end', gap: 6 },
  cardRightTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  moreBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  memoChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  memoChipText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  noMatch: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 14, textAlign: 'center', paddingVertical: 24 },
});
