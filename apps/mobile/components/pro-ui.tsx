import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/buttons';
import { MASCOT, MASCOT_SIZE, type MascotPose } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * ACTTUB Pro 화면의 공용 조각(SOMA-818, pen ⑥ Pro). 새 디자인 시스템이 아니라 pen 수치를 기존 팔레트로 옮긴 것이다.
 * PRO 배지는 pen 의 남색(#1B2B4B) 그대로다.
 */
const PRO_NAVY = '#1B2B4B';

export function ProBadge({ small = false }: { small?: boolean }) {
  return (
    <View style={[styles.badge, small && styles.badgeSmall]}>
      <Text style={[styles.badgeText, small && styles.badgeTextSmall]}>{t('pro.badge')}</Text>
    </View>
  );
}

/** pen 「비교」 — 무료/Pro 네 줄. */
export function ProCompareTable() {
  const rows: [string, string, string][] = [
    [t('pro.rowCoaching'), t('pro.freeCoaching'), t('pro.unlimited')],
    [t('pro.rowScripts'), t('pro.freeScripts'), t('pro.unlimited')],
    [t('pro.rowPron'), t('pro.freeNone'), t('pro.proPron')],
    [t('pro.rowChallenge'), t('pro.freeChallenge'), t('pro.proChallenge')],
  ];
  return (
    <View style={styles.table}>
      <View style={styles.tableRow}>
        <Text style={styles.cellLabel} />
        <Text style={[styles.cell, styles.headFree]}>{t('pro.colFree')}</Text>
        <Text style={[styles.cell, styles.headPro]}>{t('pro.colPro')}</Text>
      </View>
      {rows.map(([label, free, pro]) => (
        <View key={label} style={[styles.tableRow, styles.tableLine]}>
          <Text style={styles.cellLabel}>{label}</Text>
          <Text style={[styles.cell, styles.free]}>{free}</Text>
          <Text style={[styles.cell, styles.pro]}>{pro}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * pen 아래 시트(a5y1Qr·WLdNc·K7q5Vk) — 손잡이 · 액티 · 제목 19/800 · 설명 14 · [주 버튼] · 글자 버튼. 모달 없이 내용만이라
 * 이미 모달을 쓰는 화면(리딩 새 대본)이 자기 모달 안에 그린다.
 */
export function ProSheetCard({
  title,
  body,
  primary,
  onPrimary,
  secondary,
  onSecondary,
  pose = 'coach',
  busy = false,
  destructive = false,
}: {
  title: string;
  body: string;
  primary: string;
  onPrimary: () => void;
  secondary: string;
  onSecondary: () => void;
  pose?: MascotPose;
  busy?: boolean;
  destructive?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]} accessibilityViewIsModal>
      <View style={styles.handle} />
      <Image source={MASCOT[pose]} style={styles.sheetMascot} contentFit="contain" />
      <Text style={styles.sheetTitle}>{title}</Text>
      <Text style={styles.sheetBody}>{body}</Text>
      <Button variant={destructive ? 'danger' : 'primary'} label={primary} onPress={onPrimary} loading={busy} disabled={busy}
        style={styles.sheetButton} />
      <Pressable onPress={onSecondary} disabled={busy} accessibilityRole="button" hitSlop={8} style={styles.sheetSecondary}>
        <Text style={styles.sheetSecondaryText}>{secondary}</Text>
      </Pressable>
    </View>
  );
}

/** 모달로 감싼 아래 시트. 바깥을 누르면 글자 버튼과 같다. */
export function ProSheet(props: React.ComponentProps<typeof ProSheetCard> & { visible: boolean }) {
  const { visible, ...card } = props;
  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent onRequestClose={card.onSecondary}>
      <Pressable style={styles.backdrop} onPress={card.onSecondary} accessibilityRole="button"
        accessibilityLabel={card.secondary} />
      <View style={styles.sheetDock}>
        <ProSheetCard {...card} />
      </View>
    </Modal>
  );
}

/**
 * pen a5y1Qr 「오늘 무료 코칭을 다 썼어요」. 서버가 429 free_daily_coaching_limit 을 줄 때만 뜬다(무료 한도 플래그가 꺼져 있으면
 * 서버가 이 코드를 보내지 않는다). [Pro 알아보기]는 Pro 안내로, 「내일 할게요」는 닫는다.
 */
export function CoachingLimitSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  return (
    <ProSheet
      visible={visible}
      title={t('pro.coachingLimitTitle')}
      body={t('pro.coachingLimitBody')}
      primary={t('pro.explore')}
      onPrimary={() => {
        onClose();
        router.push('/pro');
      }}
      secondary={t('pro.coachingLimitLater')}
      onSecondary={onClose}
    />
  );
}

/**
 * pen hD5to 「외부 결제 안내」. 실제 Apple StoreKit External Purchase 시스템 창이 아니라 같은 문구의 앱 화면이다 — 출시 전에
 * Apple 승인과 네이티브 창(entitlement)으로 바꿔야 한다.
 */
export function ExternalPurchaseNotice({
  visible,
  onCancel,
  onContinue,
  onLearnMore,
}: {
  visible: boolean;
  onCancel: () => void;
  onContinue: () => void;
  onLearnMore: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.alertBackdrop}>
        <View style={styles.alert} accessibilityViewIsModal>
          <View style={styles.alertBody}>
            <Text style={styles.alertTitle}>{t('pro.externalTitle')}</Text>
            <Text style={styles.alertText}>{t('pro.externalBody')}</Text>
            <Pressable onPress={onLearnMore} accessibilityRole="link" hitSlop={6}>
              <Text style={styles.alertLink}>{t('pro.externalMore')}</Text>
            </Pressable>
          </View>
          <View style={styles.alertButtons}>
            <Pressable style={styles.alertButton} onPress={onCancel} accessibilityRole="button">
              <Text style={styles.alertButtonText}>{t('pro.externalCancel')}</Text>
            </Pressable>
            <View style={styles.alertDivider} />
            <Pressable style={styles.alertButton} onPress={onContinue} accessibilityRole="button">
              <Text style={[styles.alertButtonText, styles.alertButtonStrong]}>{t('pro.externalContinue')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** 구독 관리의 혜택 줄(체크 · 제목 · 설명). */
export function ProBenefitRow({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={styles.benefit}>
      <Feather name="check" size={18} color={palette.blue} />
      <Text style={styles.benefitTitle}>{title}</Text>
      <Text style={styles.benefitSub}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', backgroundColor: PRO_NAVY, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  badgeSmall: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { color: palette.onAccent, fontSize: 12, fontWeight: '800' },
  badgeTextSmall: { fontSize: 11 },
  table: { borderRadius: 18, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 16, paddingVertical: 6 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  tableLine: { borderTopWidth: 1, borderTopColor: palette.borderSoft },
  cellLabel: { flex: 1.5, fontSize: 14, fontWeight: '600', color: palette.text },
  cell: { flex: 1, textAlign: 'center', fontSize: 13 },
  headFree: { fontWeight: '700', color: palette.textFaint },
  headPro: { fontWeight: '800', color: palette.blueDeep },
  free: { color: palette.textFaint },
  pro: { fontWeight: '700', color: palette.blueDeep },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  sheetDock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: {
    alignSelf: 'stretch',
    backgroundColor: palette.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 10,
    alignItems: 'center',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: palette.borderSoft, marginBottom: 18 },
  sheetMascot: MASCOT_SIZE.md,
  sheetTitle: { marginTop: 12, fontSize: 19, fontWeight: '800', color: palette.text, textAlign: 'center', lineHeight: 26 },
  sheetBody: { marginTop: 8, fontSize: 14, color: palette.textDim, textAlign: 'center', lineHeight: 21 },
  sheetButton: { alignSelf: 'stretch', marginTop: 22 },
  sheetSecondary: { paddingVertical: 14 },
  sheetSecondaryText: { fontSize: 15, fontWeight: '600', color: palette.textDim },
  alertBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', alignItems: 'center', justifyContent: 'center' },
  alert: { width: 290, borderRadius: 14, backgroundColor: '#F2F2F7', overflow: 'hidden' },
  alertBody: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16, gap: 8, alignItems: 'center' },
  alertTitle: { fontSize: 15, fontWeight: '700', color: palette.text, textAlign: 'center' },
  alertText: { fontSize: 12, color: '#3C3C43', textAlign: 'center', lineHeight: 17 },
  alertLink: { fontSize: 13, color: '#007AFF' },
  alertButtons: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#C6C6C8' },
  alertButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  alertDivider: { width: StyleSheet.hairlineWidth, backgroundColor: '#C6C6C8' },
  alertButtonText: { fontSize: 16, color: '#007AFF' },
  alertButtonStrong: { fontWeight: '600' },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  benefitTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: palette.text },
  benefitSub: { fontSize: 13, color: palette.textFaint },
});
