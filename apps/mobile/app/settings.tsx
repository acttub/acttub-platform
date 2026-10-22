import Feather from '@expo/vector-icons/Feather';
import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import { loadVoiceFeedbackEnabled, saveVoiceFeedbackEnabled } from '@/lib/reading/voice-feedback-setting';
import { openStoreReviewPage } from '@/lib/store-review';

/**
 * S15 설정(pen S15.3 · S15.17) — 프로필 오른쪽 위 ⚙ 로 들어온다. 한 줄로 이어지는 목록이고, 묶음은
 * 프로필 · 연습과 기록 · 의견 · 계정 순서다. 줄은 테두리 없이 아이콘 · 제목 · 설명 · 꺾쇠만 둔다.
 * 보관함 줄은 없다(영상은 연습 기록에 남는다). Pro 줄은 결제 화면을 미뤄서 두지 않는다.
 * 회원 탈퇴는 깊이 숨기지 않는다 — 앱스토어 심사가 계정 삭제를 앱 안에서 찾을 수 있는지 본다.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { confirm, alert, dialog } = useAppDialog();
  // 실험 기능 — 발음 피드백. 기본 꺼짐, 기기에만 저장.
  const [voiceFeedback, setVoiceFeedback] = useState(false);
  useEffect(() => {
    void loadVoiceFeedbackEnabled().then(setVoiceFeedback);
  }, []);
  const toggleVoiceFeedback = (value: boolean) => {
    setVoiceFeedback(value);
    void saveVoiceFeedbackEnabled(value).catch(() => setVoiceFeedback(!value));
  };

  const confirmLogout = async () => {
    const ok = await confirm({
      title: t('settings.logoutTitle'),
      confirmLabel: t('settings.logout'),
      destructive: true,
    });
    if (ok) void signOut();
  };

  const openContactMail = async () => {
    const url = 'mailto:acttub0527@gmail.com?subject=' + encodeURIComponent(t('settings.contactSubject'));
    try {
      const okToOpen = await Linking.canOpenURL(url);
      if (okToOpen) await Linking.openURL(url);
      else throw new Error('cannot open');
    } catch {
      void alert({ title: t('settings.contactMailFail'), message: 'acttub0527@gmail.com' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('settings.title')} left={<NavBackButton onPress={() => router.back()} />} />

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.sectionTitle}>{t('settings.profile')}</Text>
        <Row icon="user" title={t('settings.profileEditTitle')} sub={t('settings.profileEditBody')} onPress={() => router.push('/profile-edit')} />
        {/* 웹에서 로그인 없이 해 본 연습·대본을 여섯 자리 코드로 이 계정에 가져온다. */}
        <Row icon="download" title={t('settings.transferTitle')} sub={t('settings.transferBody')} onPress={() => router.push('/guest-transfer')} />

        <Text style={styles.sectionTitle}>{t('settings.sectionPractice')}</Text>
        <Row icon="bell" title={t('settings.notifications')} sub={t('settings.notificationsSub')} onPress={() => router.push('/notification-settings')} />
        <Row icon="book" title={t('settings.memoryLink')} sub={t('settings.memoryHint')} onPress={() => router.push('/memory')} />
        <Row icon="award" title={t('settings.challengeRecordRow')} sub={t('settings.challengeRecordSub')} onPress={() => router.push('/challenge-entries')} />
        {/* 실험 기능 — 발음 피드백. 기본 꺼짐, 기기에만 저장. */}
        <Row
          icon="mic"
          iconColor={palette.flame}
          title={t('voiceFeedback.settingsTitle')}
          sub={t('voiceFeedback.settingsBody')}
          right={
            <Switch
              value={voiceFeedback}
              onValueChange={toggleVoiceFeedback}
              accessibilityLabel={t('voiceFeedback.settingsTitle')}
              trackColor={{ true: palette.flame, false: palette.border }}
              thumbColor={palette.onAccent}
              ios_backgroundColor={palette.border}
            />
          }
        />

        <Text style={styles.sectionTitle}>{t('settings.feedbackSection')}</Text>
        {/* 문의·신고 (SOMA-499, App Store 1.2 — 앱 안에서 부적절 활동을 신고할 창구) */}
        <Row icon="mail" title={t('settings.contactAction')} sub={t('settings.contactSub')} onPress={() => void openContactMail()} />
        {/* 앱 평가하기 — 스토어의 리뷰 쓰기 화면을 바로 연다. */}
        <Row icon="star" title={t('settings.storeReviewTitle')} sub={t('settings.storeReviewSub')} onPress={() => void openStoreReviewPage()} />

        <Text style={styles.sectionTitle}>{t('settings.sectionManage')}</Text>
        <Row icon="file-text" title={t('settings.consentHistory')} sub={t('settings.consentHistorySub')} onPress={() => router.push('/consent-history')} />
        {/* 차단은 챌린지에서만 쓰인다(challenge.block). */}
        <Row icon="slash" title={t('block.settingsLink')} sub={t('settings.blockedSub')} onPress={() => router.push('/blocked-users')} />
        <Row icon="log-out" title={t('settings.logout')} onPress={() => void confirmLogout()} />
        <Row icon="trash-2" danger title={t('settings.withdraw')} sub={t('settings.withdrawSub')} onPress={() => router.push('/delete-account')} />

        {/* 개발 빌드에서만 보인다. 영상 업로드·분석을 지나지 않고 화면만 확인하는 통로. */}
        {__DEV__ && (
          <Pressable style={styles.previewRow} onPress={() => router.push('/ui-preview')}>
            <Text style={styles.previewText}>{t('settings.uiPreview')}</Text>
          </Pressable>
        )}

        <Text style={styles.version}>{t('settings.version', { version: Constants.expoConfig?.version ?? '' })}</Text>
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** 설정 한 줄 — 테두리 없이 아이콘 · 제목(17/800) · 설명(13.5) · 꺾쇠. `right`를 주면 꺾쇠 대신 그것(스위치)을 둔다. */
function Row({
  icon,
  title,
  sub,
  onPress,
  right,
  danger,
  iconColor,
}: {
  icon: FeatherName;
  title: string;
  sub?: string;
  onPress?: () => void;
  right?: ReactNode;
  danger?: boolean;
  iconColor?: string;
}) {
  const color = danger ? palette.danger : (iconColor ?? palette.textMuted);
  const content = (
    <>
      <Feather name={icon} size={22} color={color} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, danger && styles.rowTitleDanger]}>{title}</Text>
        {!!sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
      {right ?? (onPress ? <Feather name="chevron-right" size={20} color={palette.checkOff} /> : null)}
    </>
  );
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bgSubtle },
  list: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 32 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: palette.text, marginTop: 20, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, minHeight: 56 },
  rowPressed: { opacity: 0.6 },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontSize: 17, fontWeight: '800', lineHeight: 23, color: palette.text },
  rowTitleDanger: { color: palette.danger },
  rowSub: { fontSize: 13.5, fontWeight: '400', lineHeight: 20, color: palette.textFaint },
  previewRow: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  previewText: { fontSize: 13.5, fontWeight: '800', color: palette.textFaint },
  version: { marginTop: 24, textAlign: 'center', fontSize: 13, fontWeight: '500', color: palette.textFaint },
});
