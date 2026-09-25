import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { avatarLetter } from '@/lib/challenge/browse';
import { blockFailureMessage, blockedLabel } from '@/lib/challenge/moderation';
import type { BlockedUser } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

/**
 * A4 설정의 차단 목록(challenge.block).
 *
 * 차단한 사람을 이름(첫 글자 아바타)으로 보고 풀 수 있다. 상대에게는 차단 사실을 알리지 않고
 * 상대 화면에도 표시가 없다. 차단은 신고를 대신하지 않는다 — 신고는 운영에 알리는 것이다.
 */
export default function BlockedUsersScreen() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const [users, setUsers] = useState<BlockedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.listBlocks();
      setUsers(result.users);
    } catch {
      setUsers([]);
      setError(t('block.loadFail'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unblock = async (user: BlockedUser) => {
    try {
      await api.blockUser(user.user_id, false);
      setUsers((prev) => (prev ?? []).filter((u) => u.user_id !== user.user_id));
      void alert({ title: t('block.title'), message: t('block.unblockDone') });
    } catch (e) {
      void alert({ title: t('block.title'), message: blockFailureMessage(e) });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('block.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {users === null && !error && <ActivityIndicator color={palette.blue} style={{ marginTop: 32 }} />}
        {!!error && <Text style={styles.error}>{error}</Text>}
        {users !== null && users.length === 0 && !error && <Text style={styles.empty}>{t('block.empty')}</Text>}

        {users?.map((user) => (
          <View key={user.user_id} style={styles.row}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{avatarLetter(blockedLabel(user))}</Text>
            </View>
            <Text style={styles.name}>{blockedLabel(user)}</Text>
            <Pressable style={styles.unblock} onPress={() => void unblock(user)} accessibilityRole="button">
              <Text style={styles.unblockText}>{t('block.unblock')}</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  title: { fontSize: 18, fontWeight: '800', color: palette.text },
  body: { padding: 16, paddingBottom: 48 },
  error: { color: palette.danger, fontSize: 13.5, fontWeight: '700', textAlign: 'center', paddingVertical: 16 },
  empty: { color: palette.textDim, fontSize: 14.5, textAlign: 'center', paddingVertical: 48 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '900', color: palette.blueDeep },
  name: { flex: 1, fontSize: 15, fontWeight: '700', color: palette.text },
  unblock: { borderRadius: 999, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 14, paddingVertical: 8 },
  unblockText: { fontSize: 13, fontWeight: '800', color: palette.textDim },
});
