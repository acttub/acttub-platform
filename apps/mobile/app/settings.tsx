import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { useAppDialog } from '@/components/app-dialog';
import { BlueSwitch, ListRow, SectionGap, SectionLabel } from '@/components/ui/list-rows';
import { palette } from '@/constants/palette';
import { useAuth } from '@/lib/auth';
import { resetSpotlights } from '@/lib/guide-state';
import { translate as t } from '@/lib/i18n';
import { loadVoiceFeedbackEnabled, saveVoiceFeedbackEnabled } from '@/lib/reading/voice-feedback-setting';
import { openStoreReviewPage } from '@/lib/store-review';

/**
 * S15 설정(pen 「설정 및 활동」, SOMA-748) — 프로필 오른쪽 위 ⚙ 로 들어온다. 묶음 목록(내 계정 / 연습과 기록 /
 * 앱 · 도움말 / 계정)과 맨 아래 빨간 로그아웃.
 *
 * 알림 토글 셋은 「알림」 화면(notification-settings)으로, 동의 목록은 「동의 내역」 화면(consent-history)으로 옮겼다.
 * 서버 기능이 없는 줄(Pro 구독·앱 언어·자주 묻는 질문·내 데이터)은 그리지 않는다. 회원 탈퇴는 pen 에서 「내 데이터」
 * 안에 있지만 그 화면이 없으므로 계정 묶음에 남긴다 — 앱스토어 심사가 계정 삭제를 앱 안에서 찾을 수 있는지 본다.
 * 코치의 기억은 틀린 내용을 되돌릴 수 있는 유일한 자리, 문의·신고는 앱 안 신고 창구(SOMA-499)라 남긴다.
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
        <SectionLabel label={t('settings.sectionAccount')} />
        <ListRow icon="user" title={t('settings.profileEditTitle')} onPress={() => router.push('/profile-edit')} />
        {/* 웹에서 로그인 없이 해 본 연습·대본을 여섯 자리 코드로 이 계정에 가져온다. */}
        <ListRow icon="download" title={t('settings.transferTitle')} onPress={() => router.push('/guest-transfer')} />

        <SectionGap />
        <SectionLabel label={t('settings.sectionPractice')} />
        <ListRow icon="bell" title={t('settings.notifications')} onPress={() => router.push('/notification-settings')} />
        <ListRow icon="archive" title={t('settings.archiveRow')} onPress={() => router.push('/archive')} />
        <ListRow
          iconNode={<Ionicons name="sparkles-outline" size={22} color={palette.text} />}
          title={t('settings.memoryLink')}
          onPress={() => router.push('/memory')}
        />
        <ListRow icon="award" title={t('settings.challengeRecordRow')} onPress={() => router.push('/challenge-entries')} />

        <SectionGap />
        <SectionLabel label={t('settings.sectionApp')} />
        <ListRow
          icon="mic"
          title={t('voiceFeedback.settingsTitle')}
          right={
            <BlueSwitch
              value={voiceFeedback}
              onValueChange={toggleVoiceFeedback}
              accessibilityLabel={t('voiceFeedback.settingsTitle')}
            />
          }
        />
        {/* 차단은 챌린지에서만 쓰인다(challenge.block). */}
        <ListRow icon="slash" title={t('block.settingsLink')} onPress={() => router.push('/blocked-users')} />
        {/* 문의·신고 (SOMA-499, App Store 1.2 — 앱 안에서 부적절 활동을 신고할 창구) */}
        <ListRow icon="mail" title={t('settings.contactSection')} onPress={() => void openContactMail()} />
        {/* 앱 평가하기 — 스토어의 리뷰 쓰기 화면을 바로 연다(한줄평은 SOMA-494에서 걷었다). */}
        <ListRow icon="star" title={t('settings.storeReviewRow')} onPress={() => void openStoreReviewPage()} />
        {/* 첫 시작 가이드 다시 보기 — pen 엔 없지만 화면에서 누를 자리를 비춰 주던 안내를 되살리는 유일한 길이라 남긴다. */}
        <ListRow
          icon="compass"
          title={t('settings.guideTitle')}
          onPress={() => {
            void resetSpotlights();
            router.push('/guide');
          }}
        />

        <SectionGap />
        <SectionLabel label={t('settings.sectionManage')} />
        <ListRow icon="file-text" title={t('settings.consentHistory')} onPress={() => router.push('/consent-history')} />
        {/* 깊이 숨기지 않는다 — 앱스토어 심사가 계정 삭제를 앱 안에서 찾을 수 있는지 본다. */}
        <ListRow icon="user-x" title={t('settings.withdraw')} onPress={() => router.push('/delete-account')} />
        <ListRow title={t('settings.logout')} danger onPress={() => void confirmLogout()} />

        {/* 개발 빌드에서만 보인다. 영상 업로드·분석을 지나지 않고 화면만 확인하는 통로. */}
        {__DEV__ && (
          <View style={styles.dev}>
            <ListRow icon="tool" title={t('settings.uiPreview')} onPress={() => router.push('/ui-preview')} />
          </View>
        )}
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 2 },
  dev: { marginTop: 16 },
});
