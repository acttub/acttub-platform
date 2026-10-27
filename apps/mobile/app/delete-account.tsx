import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { DangerButton, SecondaryButton, TextButton } from '@/components/ui/buttons';
import { Checkbox } from '@/components/ui/checkbox';
import { CtaBar } from '@/components/ui/cta-bar';
import { NavBackButton, NavHeader } from '@/components/ui/nav-header';
import { openStoreSubscriptions } from '@/hooks/use-store-purchase';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { storeSubscribed } from '@/lib/billing';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

/**
 * 회원탈퇴.
 *
 * 다이얼로그 하나로 끝내지 않고 화면을 따로 두는 이유가 둘 있다. 되돌릴 수 없는 일이라
 * 무엇이 지워지고 무엇이 남는지 읽을 시간이 필요하고, 앱스토어 심사(Guideline
 * 5.1.1(v))가 계정 삭제를 앱 안에서 찾을 수 있는지 확인한다.
 *
 * **문구는 서버가 실제로 하는 일과 맞춘다.** 서버는 바로 알아보게 하는 정보(이메일·이름·
 * 사진·소개, 포트폴리오, 로그인 연결, 영상·녹음)를 파기하고 나머지는 사람과 끊어 남긴다.
 * 챌린지 참여작은 비공개로 내려가고 댓글은 '탈퇴한 사용자' 로 남는다. "전부 삭제됩니다"
 * 라고 쓰면 거짓말이 된다.
 *
 * 실수 탈퇴는 두 번 확인으로 막는다 — "연습·노트는 돌아오지 않아요" 확인 줄을 눌러야 버튼이
 * 켜지고, 누르면 확인 창이 한 번 더 묻는다. 복구 요청은 받지 않는다.
 *
 * App Store·Google Play 에서 산 구독은 탈퇴해도 해지되지 않는다(스토어와 이용자 사이의 거래라 우리가 끌 수 없다, SOMA-818).
 * 그래서 누구에게나 그 사실을 적고, 지금 스토어 구독이 돌고 있는 사람에게는 스토어 구독 관리 링크를 화면 안에 함께 보인다.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const { user, deleteAccount } = useAuth();
  const { confirm, alert, dialog } = useAppDialog();
  const [working, setWorking] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [storeActive, setStoreActive] = useState(false);

  // 결제가 닫힌 서버·게스트·네트워크 오류면 링크만 숨긴다 — 안내 문구는 그대로 보인다.
  useEffect(() => {
    let live = true;
    api
      .billingMe()
      .then((me) => {
        if (live) setStoreActive(storeSubscribed(me));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('deleteAccount.screenTitle')} left={<NavBackButton onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} disabled={working} />} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{t('deleteAccount.title')}</Text>
        {!!user?.email && <Text style={styles.account}>{user.email}</Text>}

        <Section label={t('deleteAccount.secRemoved')}>
          <Bullet>{t('deleteAccount.bulletIdentity')}</Bullet>
          <Bullet>{t('deleteAccount.bulletPortfolio')}</Bullet>
          <Bullet>{t('deleteAccount.bulletSocial')}</Bullet>
          <Bullet>{t('deleteAccount.bulletMedia')}</Bullet>
          <Bullet>{t('deleteAccount.bulletLocal')}</Bullet>
        </Section>

        <Section label={t('deleteAccount.secKept')}>
          <Bullet>{t('deleteAccount.keptPractice')}</Bullet>
          <Bullet>{t('deleteAccount.keptChallenge')}</Bullet>
          <Bullet>{t('deleteAccount.keptComment')}</Bullet>
        </Section>

        <Section label={t('deleteAccount.secStore')}>
          <Bullet>{t('deleteAccount.storeNote')}</Bullet>
          {storeActive && (
            <TextButton
              tone="accent"
              label={t('pro.manageStore')}
              onPress={() => void openStoreSubscriptions().catch(() => undefined)}
            />
          )}
        </Section>

        <Section label={t('deleteAccount.secRestart')}>
          <Bullet>{t('deleteAccount.restartBody')}</Bullet>
        </Section>
      </ScrollView>

      {/* 회원 탈퇴만 주 버튼이 위, 「그대로 쓸게요」가 맨 아래(DESIGN-SYSTEM 「의도된 차이」). */}
      <CtaBar>
        <Pressable
          style={[styles.ack, acknowledged && styles.ackOn]}
          onPress={() => setAcknowledged((value) => !value)}
          disabled={working}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acknowledged, disabled: working }}>
          <Checkbox checked={acknowledged} danger />
          <Text style={[styles.ackText, acknowledged && styles.ackTextOn]}>{t('deleteAccount.acknowledge')}</Text>
        </Pressable>
        <DangerButton
          label={t('deleteAccount.cta')}
          onPress={() => void run()}
          disabled={!acknowledged || working}
          loading={working}
          loadingLabel={t('deleteAccount.working')}
        />
        <SecondaryButton label={t('deleteAccount.keep')} onPress={() => router.back()} disabled={working} />
      </CtaBar>
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
  body: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[6], gap: space[4] },
  title: { ...type.title2, color: palette.text },
  account: { ...type.caption, color: palette.textMeta, marginTop: -space[3] },
  section: { paddingTop: space[4], borderTopWidth: 1, borderTopColor: palette.border, gap: space[1.5] },
  sectionLabel: { ...type.captionBold, color: palette.textMeta },
  bullet: { flexDirection: 'row', gap: space[2] },
  dot: { ...type.body2Bold, color: palette.iconFaint },
  bulletText: { flex: 1, ...type.body2, color: palette.textSub },
  // 체크와 글자는 위쪽을 맞춘다(DESIGN-SYSTEM 「체크」).
  ack: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: 15,
    borderRadius: radius.md,
    backgroundColor: palette.bgSubtle,
  },
  ackOn: { backgroundColor: palette.dangerSoft },
  ackText: { flex: 1, ...type.body2Bold, color: palette.textSub },
  ackTextOn: { color: palette.danger },
});
