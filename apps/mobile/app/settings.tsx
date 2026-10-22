import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { useAuth } from '@/lib/auth';
import { resetSpotlights } from '@/lib/guide-state';
import { translate as t } from '@/lib/i18n';
import { loadVoiceFeedbackEnabled, saveVoiceFeedbackEnabled } from '@/lib/reading/voice-feedback-setting';
import { openStoreReviewPage } from '@/lib/store-review';

type FeatherName = ComponentProps<typeof Feather>['name'];

/** 개편 전 설정 카드 — 파란 원 아이콘 + 제목·설명 + 오른쪽(꺾쇠 또는 스위치). */
function SettingsCard({
  icon,
  title,
  sub,
  onPress,
  right,
  iconColor = palette.blue,
}: {
  icon: FeatherName;
  title: string;
  sub: string;
  onPress?: () => void;
  right?: ReactNode;
  iconColor?: string;
}) {
  const body = (
    <View style={styles.cardRow}>
      <View style={styles.iconCircle}>
        <Feather name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub}>{sub}</Text>
      </View>
      {right ?? (onPress ? <Feather name="chevron-right" size={18} color={palette.checkOff} /> : null)}
    </View>
  );
  if (!onPress) return <View style={styles.card}>{body}</View>;
  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      {body}
    </Pressable>
  );
}

/**
 * S15 설정 — 프로필 오른쪽 위 ⚙ 로 들어온다. 10/21 피드백(SOMA-790)으로 SOMA-748 개편 전의 카드 모양
 * (묶음 제목 아래 아이콘·제목·설명 카드, 맨 아래 로그아웃 버튼과 회원 탈퇴 글자)으로 되돌렸다.
 *
 * 줄 목록은 개편 뒤 것을 쓴다: 알림 토글은 「알림」 화면(notification-settings), 동의 목록은 「동의 내역」 화면
 * (consent-history)으로 들어간다. 코치의 기억은 틀린 내용을 되돌릴 수 있는 유일한 자리, 문의·신고는 앱 안 신고
 * 창구(SOMA-499)라 남긴다. 회원 탈퇴는 깊이 숨기지 않는다 — 앱스토어 심사가 계정 삭제를 앱 안에서 찾을 수 있는지 본다.
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
        <SettingsCard
          icon="user"
          title={t('settings.profileEditTitle')}
          sub={t('settings.profileEditBody')}
          onPress={() => router.push('/profile-edit')}
        />
        {/* 웹에서 로그인 없이 해 본 연습·대본을 여섯 자리 코드로 이 계정에 가져온다. */}
        <SettingsCard
          icon="download"
          title={t('settings.transferTitle')}
          sub={t('settings.transferBody')}
          onPress={() => router.push('/guest-transfer')}
        />

        <Text style={styles.sectionTitle}>{t('settings.sectionPractice')}</Text>
        <SettingsCard
          icon="bell"
          title={t('settings.notifications')}
          sub={t('settings.notificationsSub')}
          onPress={() => router.push('/notification-settings')}
        />
        <SettingsCard
          icon="archive"
          title={t('settings.archiveRow')}
          sub={t('settings.archiveSub')}
          onPress={() => router.push('/archive')}
        />
        <SettingsCard
          icon="book"
          title={t('settings.memoryLink')}
          sub={t('settings.memoryHint')}
          onPress={() => router.push('/memory')}
        />
        <SettingsCard
          icon="award"
          title={t('settings.challengeRecordRow')}
          sub={t('settings.challengeRecordSub')}
          onPress={() => router.push('/challenge-entries')}
        />

        <Text style={styles.sectionTitle}>{t('voiceFeedback.settingsSection')}</Text>
        <SettingsCard
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
        {/* 앱 평가하기 — 스토어의 리뷰 쓰기 화면을 바로 연다(한줄평은 SOMA-494에서 걷었다). */}
        <SettingsCard
          icon="star"
          title={t('settings.storeReviewTitle')}
          sub={t('settings.storeReviewSub')}
          onPress={() => void openStoreReviewPage()}
        />
        {/* 첫 시작 가이드 다시 보기 — 슬라이드를 열고, 화면에서 누를 자리를 비춰 주던 안내도 되살린다. */}
        <SettingsCard
          icon="compass"
          title={t('settings.guideTitle')}
          sub={t('settings.guideSub')}
          onPress={() => {
            void resetSpotlights();
            router.push('/guide');
          }}
        />
        {/* 차단은 챌린지에서만 쓰인다(challenge.block). */}
        <SettingsCard
          icon="slash"
          title={t('block.settingsLink')}
          sub={t('block.settingsHint')}
          onPress={() => router.push('/blocked-users')}
        />
        {/* 문의·신고 (SOMA-499, App Store 1.2 — 앱 안에서 부적절 활동을 신고할 창구) */}
        <SettingsCard
          icon="mail"
          title={t('settings.contactAction')}
          sub={t('settings.contactHint')}
          onPress={() => void openContactMail()}
        />

        <Text style={styles.sectionTitle}>{t('settings.sectionManage')}</Text>
        <SettingsCard
          icon="file-text"
          title={t('settings.consentHistory')}
          sub={t('settings.consentHistorySub')}
          onPress={() => router.push('/consent-history')}
        />

        {/* 개발 빌드에서만 보인다. 영상 업로드·분석을 지나지 않고 화면만 확인하는 통로. */}
        {__DEV__ && (
          <Pressable style={styles.previewRow} onPress={() => router.push('/ui-preview')}>
            <Text style={styles.previewText}>{t('settings.uiPreview')}</Text>
          </Pressable>
        )}

        <View style={styles.spacer} />

        <Pressable style={styles.logout} onPress={() => void confirmLogout()}>
          <Text style={styles.logoutText}>{t('settings.logout')}</Text>
        </Pressable>
        <Pressable
          style={styles.deleteRow}
          onPress={() => router.push('/delete-account')}
          accessibilityRole="button"
          accessibilityLabel={t('settings.withdraw')}>
          <Text style={styles.deleteText}>{t('settings.withdraw')}</Text>
        </Pressable>
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bgSubtle },
  list: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 10 },
  sectionTitle: { fontSize: 13.5, fontWeight: '800', color: palette.text, marginTop: 12 },
  card: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 15.5, fontWeight: '800', color: palette.text },
  cardSub: { fontSize: 12.5, color: palette.textFaint, lineHeight: 17 },
  previewRow: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  previewText: { fontSize: 13.5, fontWeight: '800', color: palette.textFaint },
  spacer: { flex: 1, minHeight: 24 },
  logout: {
    paddingVertical: 17,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    alignItems: 'center',
  },
  logoutText: { color: palette.danger, fontSize: 16, fontWeight: '800' },
  deleteRow: { marginTop: 6, paddingVertical: 14, alignItems: 'center' },
  deleteText: { color: palette.textFaint, fontSize: 14, fontWeight: '600' },
});
