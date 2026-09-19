import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { Markdown } from '@/components/markdown';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { useFeedbackSheet } from '@/hooks/use-feedback-sheet';
import { useAuth } from '@/lib/auth';
import {
  consentChangeFailureAction,
  consentSettingsRows,
  type ConsentSettingsRow,
} from '@/lib/consent-entry';
import { translate as t } from '@/lib/i18n';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  loadNotificationSettings,
  openNotificationPermissionSettings,
  setNotificationToggle,
  type NotificationSettings,
} from '@/lib/notifications';

/** 동의 문서 카드의 아이콘 — 제목으로 고른다(서버 문서엔 아이콘 필드가 없다). */
function docIcon(title: string): ReactNode {
  if (/개인정보|privacy/i.test(title)) return <Feather name="shield" size={18} color={palette.blue} />;
  if (/ai|분석|analysis/i.test(title)) return <Ionicons name="sparkles-outline" size={18} color={palette.blue} />;
  return <Feather name="file-text" size={18} color={palette.blue} />;
}

/** 알림 토글 셋. 순서대로 그린다. */
const NOTIFICATION_TOGGLES: {
  key: keyof NotificationSettings;
  icon: 'bell' | 'award' | 'moon';
  titleKey: string;
  bodyKey: string;
}[] = [
  { key: 'analysis_done', icon: 'bell', titleKey: 'settings.notifAnalysisTitle', bodyKey: 'settings.notifAnalysisBody' },
  { key: 'challenge', icon: 'award', titleKey: 'settings.notifChallengeTitle', bodyKey: 'settings.notifChallengeBody' },
  { key: 'evening_reminder', icon: 'moon', titleKey: 'settings.notifReminderTitle', bodyKey: 'settings.notifReminderBody' },
];

/**
 * A4 설정 — "‹ 설정" 헤더 아래 프로필 수정 진입점, 동의 목록, 알림 토글 셋, 맨 아래
 * 로그아웃·회원 탈퇴.
 *
 * 동의 목록은 문서마다 제목·판·시행일·내 결정·결정 시각을 보여 준다. 필수 문서는 내용만 보고
 * (거두는 길은 탈퇴뿐), 선택 문서는 동의와 거절을 오가며 바꾸는 즉시 저장한다. 문서와 현재
 * 결정은 서버의 동의 현황(GET /v2/consents/entry)이 정본이다 — 기기에 따로 적어 두지 않는다.
 *
 * 알림 토글 셋(분석 완료·챌린지·저녁 리마인드)은 서버의 프로필에 저장돼 폰을 바꿔도 유지된다.
 * 코치의 기억과 문의·신고는 pen엔 없지만 각각 기억 수정 창구·앱스토어 신고 창구(SOMA-499)라
 * 같은 카드 모양으로 남긴다.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [rows, setRows] = useState<ConsentSettingsRow[]>([]);
  const [notif, setNotif] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingConsentId, setUpdatingConsentId] = useState<string | null>(null);
  const [updatingToggle, setUpdatingToggle] = useState<keyof NotificationSettings | null>(null);
  const { confirm, alert, dialog } = useAppDialog();
  const feedback = useFeedbackSheet('settings');

  const loadConsents = useCallback(async () => {
    setRows(consentSettingsRows(await api.consentEntry()));
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [, settings] = await Promise.all([loadConsents(), loadNotificationSettings()]);
      setNotif(settings);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('consent.docFail'));
    } finally {
      setLoading(false);
    }
  }, [loadConsents]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const toggleNotification = useCallback(
    async (key: keyof NotificationSettings, next: boolean) => {
      if (updatingToggle) return;
      const previous = notif;
      setUpdatingToggle(key);
      setNotif({ ...previous, [key]: next }); // 낙관적 업데이트
      try {
        const result = await setNotificationToggle(previous, key, next);
        setNotif(result.settings);
        if (result.kind === 'permission_blocked') {
          // OS 알림 권한이 꺼져 있으면 토글을 켜도 알림이 오지 않는다. 권한 설정으로 안내한다.
          const open = await confirm({
            title: t('settings.notifPermissionTitle'),
            message: t('settings.notifPermissionBody'),
            confirmLabel: t('settings.notifPermissionOpen'),
          });
          if (open) await openNotificationPermissionSettings().catch(() => undefined);
        }
      } catch (err) {
        setNotif(previous); // 실패 시 롤백
        void alert({
          title: t('settings.changeFailTitle'),
          message: err instanceof Error ? err.message : t('common.tryLater'),
        });
      } finally {
        setUpdatingToggle(null);
      }
    },
    [notif, updatingToggle, confirm, alert],
  );

  // 선택 문서는 동의와 거절을 오간다. 바꾸는 즉시 저장하고, 되돌리려면 다시 바꾼다.
  const toggleConsent = useCallback(
    async (row: ConsentSettingsRow, granted: boolean) => {
      if (updatingConsentId || !row.canChange) return;
      const decision = granted ? 'granted' : 'declined';
      setUpdatingConsentId(row.id);
      setRows((current) =>
        current.map((item) => (item.id === row.id ? { ...item, decision } : item)),
      ); // 낙관적 업데이트
      try {
        await api.recordConsent(row.id, decision);
        // 결정 시각은 서버가 정한다. 다시 받아 그린다.
        await loadConsents().catch(() => undefined);
      } catch (err) {
        if (consentChangeFailureAction(err) === 'reload') {
          // 보는 사이 새 판이 나왔다. 목록을 다시 받아 현재 판을 보여 준다.
          await loadConsents().catch(() => undefined);
          void alert({ title: t('settings.changeFailTitle'), message: t('consent.outdated') });
        } else {
          setRows((current) =>
            current.map((item) => (item.id === row.id ? { ...item, decision: row.decision } : item)),
          ); // 실패 시 롤백
          void alert({
            title: t('settings.changeFailTitle'),
            message: err instanceof Error ? err.message : t('common.tryLater'),
          });
        }
      } finally {
        setUpdatingConsentId(null);
      }
    },
    [updatingConsentId, loadConsents, alert],
  );

  const required = rows.filter((row) => row.required);
  const optional = rows.filter((row) => !row.required);

  const confirmLogout = async () => {
    const ok = await confirm({
      title: t('settings.logoutTitle'),
      confirmLabel: t('settings.logout'),
      destructive: true,
    });
    if (ok) void signOut();
  };

  const openContactMail = async () => {
    const url = 'mailto:acttub0527@gmail.com?subject=' + encodeURIComponent('[Acttub] 문의·신고');
    try {
      const okToOpen = await Linking.canOpenURL(url);
      if (okToOpen) await Linking.openURL(url);
      else throw new Error('cannot open');
    } catch {
      void alert({ title: t('settings.contactMailFail'), message: 'acttub0527@gmail.com' });
    }
  };

  const toggleExpanded = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  /** 판 · 시행일 · 내 결정 · 결정 시각 한 줄. */
  const metaLine = (row: ConsentSettingsRow): string => {
    const parts = [t('settings.docVersion', { version: row.version })];
    if (row.effectiveDate) parts.push(t('settings.docEffective', { date: row.effectiveDate }));
    parts.push(
      row.decision === null
        ? t('settings.docUndecided')
        : t(row.decision === 'granted' ? 'settings.docGranted' : 'settings.docDeclined', {
            date: row.decidedDate ?? '',
          }).trim(),
    );
    return parts.join(' · ');
  };

  const renderDocCard = (row: ConsentSettingsRow, right: ReactNode) => (
    <View key={row.id} style={styles.card}>
      <Pressable style={styles.cardRow} onPress={() => toggleExpanded(row.id)} accessibilityRole="button">
        <View style={styles.iconCircle}>{docIcon(row.title)}</View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{row.title}</Text>
          <Text style={styles.cardSub}>{metaLine(row)}</Text>
          <Text style={styles.cardLink}>{expanded[row.id] ? t('common.fold') : t('common.detail')}</Text>
        </View>
        {right}
      </Pressable>
      {expanded[row.id] && (
        <View style={styles.docBody}>
          <Markdown source={row.body} variant="compact" />
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('settings.title')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <Text style={styles.loadError}>{loadError}</Text>
          <Pressable style={styles.reloadBtn} onPress={() => void loadSettings()}>
            <Text style={styles.reloadText}>{t('consent.reload')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {/* 프로필 — 여섯 항목과 사진·한 줄 소개를 고치는 진입점. */}
          <Text style={styles.sectionTitle}>{t('settings.profile')}</Text>
          <Pressable style={styles.card} onPress={() => router.push('/profile-edit')} accessibilityRole="button">
            <View style={styles.cardRow}>
              <View style={styles.iconCircle}>
                <Feather name="user" size={18} color={palette.blue} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{t('settings.profileEditTitle')}</Text>
                <Text style={styles.cardSub}>{t('settings.profileEditBody')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </View>
          </Pressable>

          {/* 웹에서 로그인 없이 해 본 연습·대본을 여섯 자리 코드로 이 계정에 가져온다. */}
          <Pressable style={styles.card} onPress={() => router.push('/guest-transfer')} accessibilityRole="button">
            <View style={styles.cardRow}>
              <View style={styles.iconCircle}>
                <Feather name="download" size={18} color={palette.blue} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{t('settings.transferTitle')}</Text>
                <Text style={styles.cardSub}>{t('settings.transferBody')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </View>
          </Pressable>

          {/* 필수 동의 — 내용만 본다. 바꾸는 버튼이 없다. */}
          {required.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t('settings.requiredConsent')}</Text>
              {required.map((row) =>
                renderDocCard(
                  row,
                  row.decision === 'granted' ? (
                    <Text style={styles.agreedTag}>{t('settings.agreedTag')}</Text>
                  ) : null,
                ),
              )}
              <Text style={styles.sectionNote}>{t('settings.requiredWithdrawNote')}</Text>
            </>
          )}

          {/* 선택 동의 — 켜면 동의, 끄면 거절. 바꾸는 즉시 저장한다. */}
          {optional.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t('settings.optionalConsent')}</Text>
              {optional.map((row) =>
                renderDocCard(
                  row,
                  <Switch
                    value={row.decision === 'granted'}
                    onValueChange={(v) => void toggleConsent(row, v)}
                    disabled={updatingConsentId !== null}
                    trackColor={{ true: palette.blue, false: palette.border }}
                    thumbColor="#FFFFFF"
                    ios_backgroundColor={palette.border}
                  />,
                ),
              )}
              <Text style={styles.sectionNote}>{t('settings.optionalHint')}</Text>
            </>
          )}

          {/* 알림 — 토글 셋. 서버에 저장돼 폰을 바꿔도 유지된다. */}
          <Text style={styles.sectionTitle}>{t('settings.notifications')}</Text>
          {NOTIFICATION_TOGGLES.map((toggle) => (
            <View key={toggle.key} style={styles.card}>
              <View style={styles.cardRow}>
                <View style={styles.iconCircle}>
                  <Feather name={toggle.icon} size={18} color={palette.blue} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{t(toggle.titleKey)}</Text>
                  <Text style={styles.cardSub}>{t(toggle.bodyKey)}</Text>
                </View>
                <Switch
                  value={notif[toggle.key]}
                  onValueChange={(v) => void toggleNotification(toggle.key, v)}
                  disabled={updatingToggle !== null}
                  trackColor={{ true: palette.blue, false: palette.border }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor={palette.border}
                />
              </View>
            </View>
          ))}

          {/* 의견 보내기 — 나갈 때 한 번 묻는 한줄평과 달리 언제든 남길 수 있는 자리. */}
          <Text style={styles.sectionTitle}>{t('settings.feedbackSection')}</Text>
          <Pressable style={styles.card} onPress={feedback.open} accessibilityRole="button">
            <View style={styles.cardRow}>
              <View style={styles.iconCircle}>
                <Feather name="message-square" size={18} color={palette.blue} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{t('settings.feedbackTitle')}</Text>
                <Text style={styles.cardSub}>{t('settings.feedbackSub')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </View>
          </Pressable>

          {/* 코치의 기억 — 틀린 내용을 되돌릴 수 있는 유일한 자리. */}
          <Text style={styles.sectionTitle}>{t('settings.memorySection')}</Text>
          <Pressable style={styles.card} onPress={() => router.push('/memory')} accessibilityRole="button">
            <View style={styles.cardRow}>
              <View style={styles.iconCircle}>
                <Feather name="book" size={18} color={palette.blue} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{t('settings.memoryLink')}</Text>
                <Text style={styles.cardSub}>{t('settings.memoryHint')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </View>
          </Pressable>

          {/* 문의·신고 (SOMA-499, App Store 1.2 — 앱 안에서 부적절 활동을 신고할 창구) */}
          <Text style={styles.sectionTitle}>{t('settings.contactSection')}</Text>
          <Pressable style={styles.card} onPress={() => void openContactMail()} accessibilityRole="button">
            <View style={styles.cardRow}>
              <View style={styles.iconCircle}>
                <Feather name="mail" size={18} color={palette.blue} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{t('settings.contactAction')}</Text>
                <Text style={styles.cardSub}>{t('settings.contactHint')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </View>
          </Pressable>

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

          {/* 깊이 숨기지 않는다 — 앱스토어 심사가 계정 삭제를 앱 안에서 찾을 수 있는지 본다. */}
          <Pressable
            style={styles.deleteRow}
            onPress={() => router.push('/delete-account')}
            accessibilityRole="button">
            <Text style={styles.deleteText}>{t('settings.withdraw')}</Text>
          </Pressable>
        </ScrollView>
      )}
      {feedback.element}
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bgSubtle },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  title: { fontSize: 22, fontWeight: '800', color: palette.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadError: { color: palette.danger, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  reloadBtn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 10 },
  reloadText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
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
  cardLink: { fontSize: 12.5, fontWeight: '700', color: palette.blue },
  sectionNote: { fontSize: 12.5, color: palette.textFaint, lineHeight: 18, paddingHorizontal: 4 },
  agreedTag: { fontSize: 13.5, fontWeight: '800', color: palette.green },
  docBody: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: palette.borderSoft },
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
