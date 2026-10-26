import Constants from 'expo-constants';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { useAppDialog } from '@/components/app-dialog';
import { pt } from '@/components/ui/anchored-menu';
import { SettingsCard } from '@/components/ui/settings-card';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { proVisible, settingsSub, settingsTarget, type BillingMe } from '@/lib/billing';
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
      .then(() => {
        setLanguage(next);
        void alert({ title: t('settings.languageChangedTitle'), message: t('settings.languageChangedBody', { language: LANGUAGE_LABEL[next] }) });
      })
      .catch(() => void alert({ title: t('settings.languageTitle'), message: t('settings.languageSaveFail') }));
  };
  // 실험 기능 — 발음 피드백. 기본 꺼짐, 기기에만 저장.
  const [voiceFeedback, setVoiceFeedback] = useState(false);
  useEffect(() => {
    void loadVoiceFeedbackEnabled().then(setVoiceFeedback);
  }, []);
  // Pro 구독 줄(SOMA-818) — 서버가 결제 기능을 닫아 두었으면(404)·앱 스위치가 꺼져 있고 Pro 도 아니면 숨긴다.
  const [billing, setBilling] = useState<BillingMe | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      Promise.resolve()
        .then(() => api.billingMe())
        .then((me) => alive && setBilling(me))
        .catch(() => alive && setBilling(null));
      return () => {
        alive = false;
      };
    }, []),
  );
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
    // canOpenURL 은 안드로이드 11+ 에서 매니페스트 <queries> 에 mailto 가 없으면 메일 앱이 있어도 false 다(10/25 제보).
    // 바로 열고, 받을 앱이 정말 없어 openURL 이 실패할 때만 주소를 알려 준다.
    try {
      await Linking.openURL(url);
    } catch {
      void alert({ title: t('settings.contactMailFail'), message: 'acttub0527@gmail.com' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('settings.title')} left={<NavBackButton onPress={() => router.back()} />} />

      <ScrollView contentContainerStyle={styles.list}>
        {billing && proVisible(billing) && (
          <>
            <SectionTitle>{t('pro.settingsSection')}</SectionTitle>
            <View style={styles.group}>
              <SettingsCard
                position="single"
                icon="award"
                title={t('pro.settingsTitle')}
                sub={settingsSub(billing)}
                onPress={() => router.push(settingsTarget(billing))}
              />
            </View>
          </>
        )}

        <SectionTitle>{t('settings.profile')}</SectionTitle>
        <View style={styles.group}>
          <SettingsCard position="first" icon="user" title={t('settings.profileEditTitle')} sub={t('settings.profileEditBody')} onPress={() => router.push('/profile-edit')} />
          <SettingsCard
            position="middle"
            icon="globe"
            title={t('settings.languageTitle')}
            sub={LANGUAGE_LABEL[language]}
            onPress={(e?: GestureResponderEvent) =>
              void sheet({
                anchor: pt(e),
                title: t('settings.languageTitle'),
                actions: (['system', 'ko', 'en'] as const).map((value) => ({ label: LANGUAGE_LABEL[value], onPress: () => chooseLanguage(value) })),
              })
            }
          />
          {/* 웹에서 로그인 없이 해 본 연습·대본을 여섯 자리 코드로 이 계정에 가져온다. */}
          <SettingsCard position="last" icon="download" title={t('settings.transferTitle')} sub={t('settings.transferBody')} onPress={() => router.push('/guest-transfer')} />
        </View>

        <SectionTitle>{t('settings.feedbackSection')}</SectionTitle>
        <View style={styles.group}>
          {/* 앱 평가하기 — 스토어의 리뷰 쓰기 화면을 바로 연다. */}
          <SettingsCard position="first" icon="star" title={t('settings.storeReviewTitle')} sub={t('settings.storeReviewSub')} onPress={() => void openStoreReviewPage()} />
          {/* 차단은 챌린지에서만 쓰인다(challenge.block). */}
          <SettingsCard position="middle" icon="slash" title={t('block.settingsLink')} sub={t('settings.blockedSub')} onPress={() => router.push('/blocked-users')} />
          {/* 문의·신고 (SOMA-499, App Store 1.2 — 앱 안에서 부적절 활동을 신고할 창구) */}
          <SettingsCard position="last" icon="mail" title={t('settings.contactAction')} sub={t('settings.contactSub')} onPress={() => void openContactMail()} />
        </View>

        <SectionTitle>{t('settings.sectionEtc')}</SectionTitle>
        <View style={styles.group}>
          <SettingsCard position="first" icon="bell" title={t('settings.notifications')} sub={t('settings.notificationsSub')} onPress={() => router.push('/notification-settings')} />
          <SettingsCard position="middle" icon="award" title={t('settings.challengeRecordRow')} sub={t('settings.challengeRecordSub')} onPress={() => router.push('/challenge-entries')} />
          <SettingsCard position="middle" icon="file-text" title={t('settings.consentHistory')} sub={t('settings.consentHistorySub')} onPress={() => router.push('/consent-history')} />
          {/* 실험 기능 — 발음 피드백. 기본 꺼짐, 기기에만 저장. */}
          <SettingsCard
            position="last"
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
        </View>

        <Pressable style={({ pressed }) => [styles.logout, pressed && styles.rowPressed]} onPress={() => void confirmLogout()} accessibilityRole="button" accessibilityLabel={t('settings.logout')}>
          <Text style={styles.logoutText}>{t('settings.logout')}</Text>
        </Pressable>
        <Pressable style={styles.deleteRow} onPress={() => router.push('/delete-account')} accessibilityRole="button" accessibilityLabel={t('settings.withdraw')}>
          <Text style={styles.deleteText}>{t('settings.withdraw')}</Text>
        </Pressable>

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

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bgSubtle },
  list: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 10 },
  sectionTitle: { fontSize: 13.5, fontWeight: '800', color: palette.text, paddingTop: 12 },
  group: { gap: 6 },
  rowPressed: { opacity: 0.6 },
  logout: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 17,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
  },
  logoutText: { fontSize: 16, fontWeight: '800', color: palette.danger },
  deleteRow: { alignItems: 'center', paddingTop: 20, paddingBottom: 14 },
  deleteText: { fontSize: 14, fontWeight: '600', color: palette.textFaint },
  previewRow: {
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  previewText: { fontSize: 13.5, fontWeight: '800', color: palette.textFaint },
  version: { marginTop: 8, textAlign: 'center', fontSize: 13, fontWeight: '500', color: palette.textFaint },
});
