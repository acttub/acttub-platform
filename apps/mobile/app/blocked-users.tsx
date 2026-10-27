import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { SkeletonRows } from '@/components/ui/skeleton';
import { DEFAULT_AVATAR_GONE, DefaultAvatar } from '@/components/ui/default-avatar';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
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
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')} ph-label="blocked_users_back">
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('block.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {users === null && !error && <SkeletonRows count={5} avatar card={false} style={{ paddingHorizontal: 0 }} />}
        {!!error && <Text style={styles.error}>{error}</Text>}
        {users !== null && users.length === 0 && !error && <Text style={styles.empty}>{t('block.empty')}</Text>}

        {users?.map((user) => (
          <View key={user.user_id} style={styles.row}>
            {/* pen S/BlockRow — 사람마다 같은 색의 기본 얼굴, 탈퇴한 사용자는 회색. */}
            <DefaultAvatar size={44} radius={22} seed={user.user_id} color={user.name.trim() ? undefined : DEFAULT_AVATAR_GONE} />
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
  // pen S18.4 본문 — 좌우 22, 위 16.
  body: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 48 },
  error: { color: palette.danger, fontSize: 13.5, fontWeight: '700', textAlign: 'center', paddingVertical: 16 },
  empty: { color: palette.textSub, fontSize: 14.5, textAlign: 'center', paddingVertical: 48 },
  // pen S/BlockRow — 위아래 18, 아래 선 #CBD1D8, 칸 사이 14.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: palette.text },
  unblock: { borderRadius: 999, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 15, paddingVertical: 9 },
  unblockText: { fontSize: 13.5, fontWeight: '800', color: palette.textSub },
});
