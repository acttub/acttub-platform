import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { api, type MemoryField, type MemoryItem } from '@/lib/api';
import {
  MEMORY_FIELDS,
  MEMORY_VALUE_MAX,
  isWrittenByActor,
  memoryValueTooLong,
  profileNotice,
} from '@/lib/practice/memory';
import { palette } from '@/constants/palette';
import { translate } from '@/lib/i18n';

/**
 * 코치가 나에 대해 기억하는 것 — 배우가 보고 고치는 화면.
 *
 * 코치는 연습이 끝날 때마다 대화에서 알아낸 것을 여기에 쌓고, 다음 연습을 시작할 때
 * 이걸 읽는다. 그래서 **틀린 내용을 되돌릴 수 있는 유일한 자리**가 이 화면이다.
 * 없으면 잘못 적힌 기억이 이후 모든 대화의 전제로 남는다.
 *
 * 두 가지를 반드시 보여준다.
 * - **어느 연습에서 나온 말인지** — 근거를 봐야 고칠지 판단이 선다.
 * - **누가 적었는지** — 내가 고친 칸은 코치가 다시 덮지 않는다는 걸 알아야
 *   고치는 의미가 생긴다.
 *
 * 성별·나이는 1.0.0에서 프로필로 옮겼다(practice.memory) — 코치는 그것을 추론하지 않고, 이
 * 화면은 연습에서 나온 넷(목표·막히는 지점·화법 둘)만 다룬다. 값은 1,000자까지다.
 */

const FIELDS: { field: MemoryField; label: string; hint: string; placeholder: string }[] = MEMORY_FIELDS.map((field) => ({
  field,
  label: translate(`memory.fields.${field}.label`),
  hint: translate(`memory.fields.${field}.hint`),
  placeholder: translate(`memory.fields.${field}.ph`),
}));

export default function MemoryScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Record<string, MemoryItem>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const { confirm, alert, dialog } = useAppDialog();

  const load = useCallback(async () => {
    try {
      const res = await api.actorMemory();
      const next: Record<string, MemoryItem> = {};
      for (const item of res.items) next[item.field] = item;
      setItems(next);
      setDrafts(Object.fromEntries(res.items.map((i) => [i.field, i.value])));
    } catch {
      // 못 불러와도 화면은 뜬다. 빈 상태와 구분되도록 알리기만 한다.
      void alert({ title: translate('memory.loadFailTitle'), message: translate('memory.loadFailBody') });
    } finally {
      setLoading(false);
    }
  }, [alert]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (field: MemoryField) => {
      const value = (drafts[field] ?? '').trim();
      if (!value) return;
      if (memoryValueTooLong(value)) {
        void alert({ title: translate('memory.saveFailTitle'), message: translate('memory.tooLong') });
        return;
      }
      setSaving(field);
      try {
        const saved = await api.saveActorMemory(field, value);
        setItems((prev) => ({ ...prev, [field]: saved }));
        setSavedField(field);
        setTimeout(() => setSavedField(null), 1500);
      } catch (err) {
        void alert({
          title: translate('memory.saveFailTitle'),
          message: err instanceof Error ? err.message : translate('common.tryLater'),
        });
      } finally {
        setSaving(null);
      }
    },
    [drafts, alert],
  );

  const removeOne = useCallback(
    async (field: MemoryField, label: string) => {
      const ok = await confirm({
        title: translate('memory.deleteOneTitle', { label }),
        message: translate('memory.deleteOneMsg'),
        confirmLabel: translate('memory.deleteOneConfirm'),
        destructive: true,
      });
      if (!ok) return;
      try {
        await api.deleteActorMemory(field);
        setItems((prev) => {
          const next = { ...prev };
          delete next[field];
          return next;
        });
        setDrafts((prev) => ({ ...prev, [field]: '' }));
      } catch (err) {
        void alert({
          title: translate('memory.deleteFailTitle'),
          message: err instanceof Error ? err.message : translate('common.tryLater'),
        });
      }
    },
    [confirm, alert],
  );

  const removeAll = useCallback(async () => {
    const ok = await confirm({
      title: translate('memory.deleteAllTitle'),
      message: translate('memory.deleteAllMsg'),
      confirmLabel: translate('memory.deleteAllConfirm'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteAllActorMemory();
      setItems({});
      setDrafts({});
    } catch (err) {
      void alert({
        title: translate('memory.deleteFailTitle'),
        message: err instanceof Error ? err.message : translate('common.tryLater'),
      });
    }
  }, [confirm, alert]);

  const hasAny = Object.keys(items).length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
          <Text style={styles.back}>{translate('memory.backToSettings')}</Text>
        </Pressable>
      </View>
      <Text style={styles.screenTitle}>{translate('memory.screenTitle')}</Text>
      <Text style={styles.screenHint}>
        {translate('memory.introBody')}
        {'\n'}
        {translate('memory.introFix')}
        <Text style={styles.bold}>{translate('memory.introBold')}</Text>
      </Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : (
        <KeyboardAwareScroll contentContainerStyle={styles.list}>
          {!hasAny && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{translate('memory.emptyTitle')}</Text>
              <Text style={styles.emptyBody}>{translate('memory.emptyBody')}</Text>
            </View>
          )}

          {FIELDS.map(({ field, label, hint, placeholder }) => {
            const item = items[field];
            const draft = drafts[field] ?? '';
            const dirty = draft.trim() !== (item?.value ?? '');
            return (
              <View key={field} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.label}>{label}</Text>
                  {item ? (
                    <Text style={isWrittenByActor(item) ? styles.tagMine : styles.tagCoach}>
                      {isWrittenByActor(item) ? translate('memory.writtenByMe') : translate('memory.tagCoach')}
                    </Text>
                  ) : (
                    <Text style={styles.tagEmpty}>{translate('memory.tagEmpty')}</Text>
                  )}
                </View>
                <Text style={styles.hint}>{hint}</Text>

                <TextInput
                  style={styles.input}
                  value={draft}
                  onChangeText={(t) => setDrafts((d) => ({ ...d, [field]: t }))}
                  placeholder={placeholder}
                  placeholderTextColor={palette.textFaint}
                  multiline
                  maxLength={MEMORY_VALUE_MAX}
                />

                {/* 출처 연습이 숨겨졌으면 서버가 null 을 준다 — 값은 그대로고 링크만 없다. */}
                {item?.source_practice_id && !isWrittenByActor(item) && (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/report-detail',
                        params: { practiceId: item.source_practice_id as string },
                      })
                    }
                    accessibilityRole="button">
                    <Text style={styles.sourceLink}>{translate('memory.sourceLink')}</Text>
                  </Pressable>
                )}

                <View style={styles.actions}>
                  {!!item && (
                    <Pressable onPress={() => void removeOne(field, label)} hitSlop={8}>
                      <Text style={styles.removeText}>{translate('memory.remove')}</Text>
                    </Pressable>
                  )}
                  <View style={styles.spacer} />
                  <Pressable
                    style={[styles.saveBtn, (!dirty || !draft.trim()) && styles.saveBtnOff]}
                    onPress={() => void save(field)}
                    disabled={!dirty || !draft.trim() || saving === field}>
                    <Text style={styles.saveBtnText}>
                      {saving === field ? translate('common.saving') : savedField === field ? translate('common.saved') : translate('common.save')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}

          {/* 성별·나이는 프로필로 옮겼다 — 여기서는 어디에 적는지만 알린다. */}
          <View style={styles.profileCard}>
            <Text style={styles.profileText}>{profileNotice()}</Text>
            <Pressable onPress={() => router.push('/profile-edit')} accessibilityRole="button">
              <Text style={styles.profileLink}>{translate('memory.openProfile')}</Text>
            </Pressable>
          </View>

          {hasAny && (
            <Pressable style={styles.removeAll} onPress={() => void removeAll()}>
              <Text style={styles.removeAllText}>{translate('memory.removeAll')}</Text>
            </Pressable>
          )}
        </KeyboardAwareScroll>
      )}
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: { paddingHorizontal: 20, paddingTop: 8 },
  back: { color: palette.textMuted, fontSize: 15 },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: palette.text,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  screenHint: {
    fontSize: 14,
    lineHeight: 21,
    color: palette.textMuted,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  bold: { fontWeight: '700', color: palette.textDim },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 20, paddingBottom: 48, gap: 14 },
  emptyCard: {
    borderRadius: 14,
    backgroundColor: palette.bgSubtle,
    padding: 16,
    gap: 6,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: palette.textStrong },
  emptyBody: { fontSize: 14, lineHeight: 20, color: palette.textMuted },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: palette.bgSubtle,
    borderRadius: 14,
    padding: 16,
  },
  profileText: { flex: 1, fontSize: 13.5, lineHeight: 21, color: palette.textDim },
  profileLink: { fontSize: 13.5, fontWeight: '800', color: palette.blueDeep },
  card: {
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 16, fontWeight: '700', color: palette.text },
  hint: { fontSize: 13, color: palette.textFaint },
  tagCoach: { fontSize: 12, color: palette.blue },
  tagMine: { fontSize: 12, color: palette.textDim, fontWeight: '700' },
  tagEmpty: { fontSize: 12, color: palette.checkOff },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    padding: 12,
    minHeight: 68,
    fontSize: 15,
    lineHeight: 22,
    color: palette.text,
    textAlignVertical: 'top',
  },
  sourceLink: { fontSize: 13, color: palette.blue },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  spacer: { flex: 1 },
  removeText: { fontSize: 14, color: palette.textMuted },
  saveBtn: {
    backgroundColor: palette.blue,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  saveBtnOff: { backgroundColor: palette.checkOff },
  saveBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  removeAll: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 14,
  },
  removeAllText: { fontSize: 14, color: palette.textMuted },
});
