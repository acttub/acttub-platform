import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { useAuth } from '@/lib/auth';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 회원탈퇴.
 *
 * 다이얼로그 하나로 끝내지 않고 화면을 따로 두는 이유가 둘 있다. 되돌릴 수 없는 일이라
 * 무엇이 지워지고 무엇이 남는지 읽을 시간이 필요하고, 앱스토어 심사(Guideline
 * 5.1.1(v))가 계정 삭제를 앱 안에서 찾을 수 있는지 확인한다.
 *
 * **문구는 서버가 실제로 하는 일과 맞춘다.** 서버는 행을 지우지 않고 이메일·닉네임·
 * 로그인 연결을 파기한다. 커뮤니티에 쓴 글은 남고 작성자가 '탈퇴한 사용자' 로 바뀐다.
 * "전부 삭제됩니다" 라고 쓰면 거짓말이 된다.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const { user, deleteAccount } = useAuth();
  const { confirm, alert, dialog } = useAppDialog();
  const [working, setWorking] = useState(false);

  const run = async () => {
    const ok = await confirm({
      title: t('deleteAccount.confirmTitle'),
      message: t('deleteAccount.confirmMsg'),
      confirmLabel: t('deleteAccount.confirmLabel'),
      destructive: true,
    });
    if (!ok) return;
    setWorking(true);
    try {
      await deleteAccount();
      // 토큰이 비워지면 루트 게이트가 로그인 화면으로 보낸다. 여기서 따로 밀지 않는다 —
      // 두 곳에서 이동시키면 화면이 겹쳐 깜빡인다.
    } catch (err) {
      setWorking(false);
      await alert({
        title: t('deleteAccount.failTitle'),
        message:
          err instanceof Error
            ? t('deleteAccount.failBodyKeep', { message: err.message })
            : t('deleteAccount.failBody'),
      });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('deleteAccount.screenTitle'), headerShadowVisible: false }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{t('deleteAccount.title')}</Text>
        {!!user?.email && <Text style={styles.account}>{user.email}</Text>}

        <Section label={t('deleteAccount.secRemoved')}>
          <Bullet>{t('deleteAccount.bulletEmail')}</Bullet>
          <Bullet>{t('deleteAccount.bulletSocial')}</Bullet>
          <Bullet>{t('deleteAccount.bulletLocal')}</Bullet>
        </Section>

        <Section label={t('deleteAccount.secKept')}>
          <Bullet>{t('deleteAccount.keptBody')}</Bullet>
          <Text style={styles.hint}>{t('deleteAccount.keptTip')}</Text>
        </Section>

        <Section label={t('deleteAccount.secRestart')}>
          <Bullet>{t('deleteAccount.restartBody')}</Bullet>
        </Section>

        <Pressable
          style={[styles.danger, working && styles.dangerOff]}
          onPress={() => void run()}
          disabled={working}
          accessibilityRole="button">
          {working ? (
            <ActivityIndicator color={palette.bg} />
          ) : (
            <Text style={styles.dangerText}>{t('deleteAccount.cta')}</Text>
          )}
        </Pressable>
        <Pressable
          style={styles.ghost}
          onPress={() => router.back()}
          disabled={working}
          accessibilityRole="button">
          <Text style={styles.ghostText}>{t('deleteAccount.keep')}</Text>
        </Pressable>
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bullet}>
      <Text style={styles.dot}>·</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { padding: 20, paddingBottom: 40, gap: 4 },
  title: { fontSize: 21, fontWeight: '900', color: palette.text, lineHeight: 31 },
  account: { fontSize: 13.5, fontWeight: '600', color: palette.textFaint, marginTop: 6 },

  section: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    paddingTop: 16,
    gap: 8,
  },
  sectionLabel: { fontSize: 11.5, fontWeight: '900', color: palette.textFaint },
  bullet: { flexDirection: 'row', gap: 8 },
  dot: { fontSize: 14, fontWeight: '900', color: palette.checkOff, lineHeight: 23 },
  bulletText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: palette.textDim,
    lineHeight: 23,
  },
  hint: { fontSize: 12.5, fontWeight: '600', color: palette.textFaint, lineHeight: 21 },

  danger: {
    marginTop: 32,
    backgroundColor: palette.danger,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  dangerOff: { opacity: 0.5 },
  dangerText: { color: palette.bg, fontSize: 15, fontWeight: '800' },
  ghost: { marginTop: 10, paddingVertical: 15, alignItems: 'center' },
  ghostText: { color: palette.textDim, fontSize: 14.5, fontWeight: '700' },
});
