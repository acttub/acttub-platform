import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';
import { previousRecordedSession } from '@/lib/reading/compare';
import { listSessions } from '@/lib/reading/store';

/**
 * 리딩 끝 화면의 「지난번과 비교」(SOMA-863). 같은 대본에 이번보다 먼저 녹음한 회차가 있을 때만 보인다.
 * 이번 회차를 녹음하지 않았으면 그리지 않는다.
 */
export function ReadingCompareLink({
  scriptId,
  session,
}: {
  scriptId: string;
  session: { id: string; started_at?: string | null; record: boolean };
}) {
  const router = useRouter();
  const [previous, setPrevious] = useState<string | null>(null);

  useEffect(() => {
    if (!session.record) return;
    let alive = true;
    listSessions(scriptId)
      .then((sessions) => {
        if (alive) setPrevious(previousRecordedSession(sessions, session));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [scriptId, session]);

  if (!previous) return null;
  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push({ pathname: '/reading/compare', params: { prev: previous, cur: session.id } })}
      accessibilityRole="button"
      accessibilityLabel={t('reading.compareLink')}>
      <Feather name="repeat" size={18} color={palette.blueDeep} />
      <View style={styles.texts}>
        <Text style={styles.title}>{t('reading.compareLink')}</Text>
        <Text style={styles.sub}>{t('reading.compareLinkSub')}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={palette.textMeta} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: palette.blueSoft, borderRadius: radius.lg, padding: space[4] },
  texts: { flex: 1, gap: 2 },
  title: { ...type.body2, fontWeight: '700', color: palette.blueDeep },
  sub: { ...type.caption, color: palette.textSub },
});
