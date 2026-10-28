import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { NavBackButton, NavHeader } from '@/components/app-header';
import { useAppDialog } from '@/components/app-dialog';
import { pt } from '@/components/ui/anchored-menu';
import { SecondaryButton, TextButton } from '@/components/ui/buttons';
import { BlueSwitch } from '@/components/ui/list-rows';
import { SettingsCard } from '@/components/ui/settings-card';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { useAuth } from '@/lib/auth';
import { useBillingMe } from '@/hooks/use-billing-me';
import { proVisible, settingsSub, settingsTarget } from '@/lib/billing';
import { languagePreference, saveLanguagePreference, translate as t, type LanguagePreference } from '@/lib/i18n';
import { loadVoiceFeedbackEnabled, saveVoiceFeedbackEnabled } from '@/lib/reading/voice-feedback-setting';
import { openStoreReviewPage } from '@/lib/store-review';

/**
 * S15 설정(pen S15.3 · S15.17) — 프로필 오른쪽 위 ⚙ 로 들어온다. 한 줄로 이어지는 목록이고, 묶음은
 * 프로필 · 연습과 기록 · 의견 · 계정 순서다. 줄은 테두리 없이 아이콘 · 제목 · 설명 · 꺾쇠만 둔다.
 * 영상 모아 보기 줄은 없다(영상은 연습 기록에 남는다). 결제 줄은 결제 화면을 미뤄서 두지 않는다.
 * 회원 탈퇴는 깊이 숨기지 않는다 — 앱스토어 심사가 계정 삭제를 앱 안에서 찾을 수 있는지 본다.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { confirm, alert, sheet, dialog } = useAppDialog();
  // 표시 언어(SOMA-827 후속). 고른 값은 다음에 켤 때 적용된다 — 지금 줄에는 고른 값을 보인다.
  const [language, setLanguage] = useState<LanguagePreference>(languagePreference());
  const LANGUAGE_LABEL: Record<LanguagePreference, string> = {
    system: t('settings.languageSystem'),
    ko: '한국어',
    en: 'English',
  };
  const chooseLanguage = (next: LanguagePreference) => {
    if (next === language) return;
    void saveLanguagePreference(next)
      // 저장하면 앱 뿌리가 새 언어로 다시 그린다(lib/i18n onLanguageChange). 이 화면도 함께 내려가므로 안내 창은 띄우지 않는다.
      .then(() => setLanguage(next))
      .catch(() => void alert({ title: t('settings.languageTitle'), message: t('settings.languageSaveFail') }));
  };
  // 실험 기능 — 발음 피드백. 기본 꺼짐, 기기에만 저장.
  const [voiceFeedback, setVoiceFeedback] = useState(false);
  useEffect(() => {
    void loadVoiceFeedbackEnabled().then(setVoiceFeedback);
  }, []);
  // Pro 구독 줄(SOMA-818) — 서버가 결제 기능을 닫아 두었으면(404)·앱 스위치가 꺼져 있고 Pro 도 아니면 숨긴다.
  // 들어올 때·앱이 돌아올 때 새로 받고, 받는 동안은 이전 값을 확정처럼 보이지 않는다(SOMA-851).
  const { me: billing, loading: billingLoading } = useBillingMe();
  const toggleVoiceFeedback = (value: boolean) => {
    setVoiceFeedback(value);
    void saveVoiceFeedbackEnabled(value).catch(() => setVoiceFeedback(!value));
  };

  const confirmLogout = async () => {
    const ok = await confirm({
      title: t('settings.logoutTitle'),
      confirmLabel: t('settings.logout'),
    });
    if (ok) void signOut();
  };

  const openContactMail = async () => {
    const url = 'mailto:acttub0527@gmail.com?subject=' + encodeURIComponent(t('settings.contactSubject'));
    // canOpenURL 은 안드로이드 11+ 에서 매니페스트 <queries> 에 mailto 가 없으면 메일 앱이 있어도 false 다(10/25 제보).
    // 바로 열고, 받을 앱이 정말 없어 openURL 이 실패할 때만 주소를 알려 준다.
    try {
      await Linking.openURL(url);
    } catch {
      void alert({ title: t('settings.contactMailFail'), message: t('settings.contactMailFailBody', { email: 'acttub0527@gmail.com' }) });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('settings.title')} left={<NavBackButton onPress={() => router.back()} />} />

      <ScrollView contentContainerStyle={styles.list}>
        <AdSlot slot="settings_top" />
        {billing && proVisible(billing) && (
          <>
            <SectionTitle>{t('pro.settingsSection')}</SectionTitle>
            <SettingsCard
              icon="award"
              title={t('pro.settingsTitle')}
              sub={billingLoading ? t('pro.loadingPlan') : settingsSub(billing)}
              onPress={() => router.push(settingsTarget(billing))}
            />
          </>
        )}

        <SectionTitle>{t('settings.profile')}</SectionTitle>
        <SettingsCard icon="user" title={t('settings.profileEditTitle')} sub={t('settings.profileEditBody')} onPress={() => router.push('/profile-edit')} />
        <SettingsCard
          icon="globe"
          title={t('settings.languageTitle')}
          sub={LANGUAGE_LABEL[language]}
          onPress={(e?: GestureResponderEvent) =>
            void sheet({
              anchor: pt(e),
              title: t('settings.languageTitle'),
              actions: (['system', 'ko', 'en'] as const).map((value) => ({ label: LANGUAGE_LABEL[value], selected: value === language, onPress: () => chooseLanguage(value) })),
            })
          }
        />
        {/* 웹에서 로그인 없이 해 본 연습·대본을 여섯 자리 코드로 이 계정에 가져온다. */}
        <SettingsCard icon="download" title={t('settings.transferTitle')} sub={t('settings.transferBody')} onPress={() => router.push('/guest-transfer')} />

        <SectionTitle>{t('settings.feedbackSection')}</SectionTitle>
        {/* 앱 평가하기 — 스토어의 리뷰 쓰기 화면을 바로 연다. */}
        <SettingsCard icon="star" title={t('settings.storeReviewTitle')} sub={t('settings.storeReviewSub')} onPress={() => void openStoreReviewPage()} />
        {/* 차단은 챌린지에서만 쓰인다(challenge.block). */}
        <SettingsCard icon="slash" title={t('block.settingsLink')} sub={t('settings.blockedSub')} onPress={() => router.push('/blocked-users')} />
        {/* 문의·신고 (SOMA-499, App Store 1.2 — 앱 안에서 부적절 활동을 신고할 창구) */}
        <SettingsCard icon="mail" title={t('settings.contactAction')} sub={t('settings.contactSub')} onPress={() => void openContactMail()} />

        <SectionTitle>{t('settings.sectionEtc')}</SectionTitle>
        <SettingsCard icon="bell" title={t('settings.notifications')} sub={t('settings.notificationsSub')} onPress={() => router.push('/notification-settings')} />
        <SettingsCard icon="award" title={t('settings.challengeRecordRow')} sub={t('settings.challengeRecordSub')} onPress={() => router.push('/challenge-entries')} />
        <SettingsCard icon="bell" title={t('settings.notices')} sub={t('settings.noticesSub')} onPress={() => router.push('/notices')} />
        <SettingsCard icon="file-text" title={t('settings.consentHistory')} sub={t('settings.consentHistorySub')} onPress={() => router.push('/consent-history')} />
        {/* 실험 기능 — 발음 피드백. 기본 꺼짐, 기기에만 저장. */}
        <SettingsCard
          icon="mic"
          title={t('voiceFeedback.settingsTitle')}
          sub={t('voiceFeedback.settingsBody')}
          right={
            <BlueSwitch value={voiceFeedback} onValueChange={toggleVoiceFeedback} accessibilityLabel={t('voiceFeedback.settingsTitle')} />
          }
        />

        <View style={styles.logout}>
          <SecondaryButton label={t('settings.logout')} onPress={() => void confirmLogout()} />
        </View>
        <TextButton label={t('settings.withdraw')} onPress={() => router.push('/delete-account')} />

        {/* 개발 빌드에서만 보인다. 영상 업로드·분석을 지나지 않고 화면만 확인하는 통로. */}
        {__DEV__ && <TextButton label={t('settings.uiPreview')} onPress={() => router.push('/ui-preview')} />}

        <Text style={styles.version}>{t('settings.version', { version: Constants.expoConfig?.version ?? '' })}</Text>
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  list: { flexGrow: 1, paddingHorizontal: space.gutter, paddingTop: space[2], gap: space[2] },
  sectionTitle: { ...type.captionBold, color: palette.textSub, marginTop: space[4] },
  logout: { paddingTop: space[6] },
  version: { ...type.caption, color: palette.textMeta, textAlign: 'center', paddingTop: space[1], paddingBottom: space[6] },
});
