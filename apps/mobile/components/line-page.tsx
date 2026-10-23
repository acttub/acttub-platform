import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { palette } from '@/constants/palette';
import { KeyboardLift } from '@/components/keyboard-lift';
import { translate as t } from '@/lib/i18n';

/**
 * 줄 고치기·둘로 나누기가 같이 쓰는 전체 화면 페이지(SOMA-821). 아래에서 올라오는 시트 대신 화면 전체를 흰 배경으로 덮고
 * (페이드), 위 머리줄(왼쪽 닫기·가운데 제목)과 아래 고정 버튼을 둔다. 아래 버튼은 KeyboardLift 안에 있어 키보드 위로 올라온다.
 */
export function LinePage({
  title,
  onClose,
  busy,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => !busy && onClose()}>
      <SafeAreaView style={styles.page} edges={['top', 'bottom']} accessibilityViewIsModal>
        <KeyboardLift aboveSafeBottom>
          <View style={styles.header}>
            <Pressable
              style={styles.close}
              hitSlop={8}
              onPress={() => !busy && onClose()}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}>
              <Ionicons name="close" size={24} color={palette.text} />
            </Pressable>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <View style={styles.close} />
          </View>
          <View style={styles.body}>{children}</View>
          <View style={styles.footer}>{footer}</View>
        </KeyboardLift>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.card },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: palette.text },
  body: { flex: 1 },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
});
