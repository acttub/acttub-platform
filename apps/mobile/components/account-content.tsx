import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';

/** 계정 없이 둘러볼 때는 서버 자료를 읽는 화면을 마운트하지 않는다. */
export function AccountContent({ children }: { children: ReactNode }) {
  const { status, leaveGuest } = useAuth();
  if (status !== 'guest') return children;
  return (
    <View style={styles.empty}>
      <Text style={styles.title}>{t('guest.title')}</Text>
      <Text style={styles.body}>{t('guest.message')}</Text>
      <Pressable accessibilityRole="button" onPress={() => void leaveGuest()} style={styles.button}>
        <Text style={styles.label}>{t('guest.cta')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, backgroundColor: palette.bg },
  title: { color: palette.text, fontSize: 20, fontWeight: '700' },
  body: { color: palette.textDim, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  button: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, backgroundColor: palette.blue },
  label: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
