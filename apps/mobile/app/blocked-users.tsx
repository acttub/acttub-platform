import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/ds/app-dialog';
import { Button } from '@/components/ds/ui/buttons';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError } from '@/components/ui/inline-error';
import { NavBackButton, NavHeader } from '@/components/ds/ui/nav-header';
import { SkeletonRows } from '@/components/ui/skeleton';
import { DEFAULT_AVATAR_GONE, DefaultAvatar } from '@/components/ui/default-avatar';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import { blockFailureMessage, blockedLabel } from '@/lib/challenge/moderation';
import type { BlockedUser } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

/**
 * A4 설정의 차단 목록(challenge.block).
 *
 * 차단한 사람을 이름(첫 글자 아바타)으로 보고 풀 수 있다. 상대에게는 차단 사실을 알리지 않는다.
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
      void alert({ title: t('block.unblockDone') });
    } catch (e) {
      void alert({ title: t('block.unblockFail'), message: blockFailureMessage(e) });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('block.title')} left={<NavBackButton onPress={() => router.back()} phLabel="blocked_users_back" />} />

      <ScrollView contentContainerStyle={styles.body}>
        {users === null && !error && <SkeletonRows count={5} avatar card={false} style={styles.flush} />}
        {!!error && <InlineError message={error} onRetry={() => void load()} />}
        {users !== null && users.length === 0 && !error && <InlineEmpty title={t('block.empty')} />}

        {users?.map((user, i) => (
          <View key={user.user_id} style={[styles.row, i > 0 && styles.divider]}>
            <DefaultAvatar size={40} radius={20} seed={user.user_id} color={user.name.trim() ? undefined : DEFAULT_AVATAR_GONE} />
            <Text style={styles.name}>{blockedLabel(user)}</Text>
            <Button size="sm" variant="secondary" label={t('block.unblock')} onPress={() => void unblock(user)} />
          </View>
        ))}
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[10] },
  flush: { paddingHorizontal: 0 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  divider: { borderTopWidth: 1, borderTopColor: palette.border },
  name: { flex: 1, ...type.body1Bold, color: palette.text },
});
