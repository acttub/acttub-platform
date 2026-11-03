import type { ReactNode } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { KeyboardLift } from '@/components/keyboard-lift';
import { CtaBar } from '@/components/ui/cta-bar';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { translate as t } from '@/lib/i18n';

/**
 * 줄 고치기·둘로 나누기가 같이 쓰는 전체 화면 페이지(SOMA-821). 아래에서 올라오는 시트 대신 화면 전체를 흰 배경으로 덮고
 * (페이드), 위 NavHeader(왼쪽 닫기·가운데 제목)와 아래 고정 바를 둔다. 아래 바는 KeyboardLift 안에 있어 키보드 위로 올라온다.
 * 안전 영역은 값으로 띄운다 — 머리를 숨긴 리딩 화면에서 연 모달은 SafeAreaView 가 위 여백을 못 받아 머리가 상태 막대와 겹쳤다.
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
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => !busy && onClose()}>
      <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityViewIsModal>
        <KeyboardLift aboveSafeBottom>
          <NavHeader
            title={title}
            left={<NavIconButton icon="x" label={t('common.close')} phLabel="line_page_close" onPress={() => !busy && onClose()} />}
          />
          <View style={styles.body}>{children}</View>
          <CtaBar safeBottom={false}>{footer}</CtaBar>
        </KeyboardLift>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.bg },
  body: { flex: 1 },
});
