import { useCallback, useRef, useState, type ReactElement } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { AnchoredMenu, type MenuAnchor } from '@/components/ui/anchored-menu';
import { DialogButtons, DialogCard } from '@/components/ui/dialog';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

export type DialogAction = {
  label: string;
  onPress?: () => void;
  /** 빨간 글씨 — 되돌릴 수 없는 동작. */
  destructive?: boolean;
};

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** 작은 확인창 모양(pen 09 「여기서 마칠까요?」). */
  compact?: boolean;
  /** 바깥·뒤로가기로 닫히지 않고 두 버튼으로만 답한다(공개 범위처럼 실수로 넘기면 안 되는 결정). */
  locked?: boolean;
};

type AlertOptions = { title: string; message?: string; confirmLabel?: string };

/** 누른 자리 근처에 뜨는 작은 메뉴. anchor 는 누른 점(화면 좌표)이고, 없으면 오른쪽 위에 뜬다. */
type SheetOptions = { title?: string; actions: DialogAction[]; anchor?: MenuAnchor };

const MENU_ROW = 48;

type DialogState =
  | { kind: 'confirm'; options: ConfirmOptions }
  | { kind: 'alert'; options: AlertOptions }
  | { kind: 'sheet'; options: SheetOptions }
  | null;

/**
 * OS 기본 Alert 대신 쓰는 앱 디자인 다이얼로그. 모양은 공통 부품 components/ui/dialog(pen Dialog/Confirm·ActionSheet).
 *
 * 기본 Alert는 안드로이드·iOS가 서로 다른 모양으로 그리고 앱 톤과 따로 논다.
 * 확인/경고는 가운데 카드, 선택지(sheet)는 누른 자리 근처의 작은 드롭다운 메뉴로 띄운다(아래 시트 금지).
 *
 * 사용법:
 *   const { confirm, alert, sheet, dialog } = useAppDialog();
 *   if (await confirm({ title: '삭제할까요?', destructive: true })) { ... }
 *   ...
 *   return (<View>...{dialog}</View>);
 */
export function useAppDialog() {
  const [state, setState] = useState<DialogState>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const close = useCallback((result: boolean) => {
    setState(null);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(result);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    setState({ kind: 'confirm', options });
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const alert = useCallback((options: AlertOptions) => {
    setState({ kind: 'alert', options });
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const sheet = useCallback((options: SheetOptions) => {
    setState({ kind: 'sheet', options });
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const locked = state?.kind === 'confirm' && state.options.locked;
  const dialog: ReactElement | null =
    state?.kind === 'sheet' ? (
      <AnchoredMenu
        anchor={state.options.anchor}
        estimatedHeight={state.options.actions.length * MENU_ROW + (state.options.title ? 36 : 0)}
        onClose={() => close(false)}>
        {state.options.title ? (
          <Text style={styles.menuTitle} numberOfLines={1}>
            {state.options.title}
          </Text>
        ) : null}
        {state.options.actions.map((action) => (
          <Pressable
            key={action.label}
            style={({ pressed }) => [styles.menuRow, pressed && styles.menuPressed]}
            accessibilityRole="button"
            onPress={() => {
              close(true);
              action.onPress?.();
            }}>
            <Text style={[styles.menuLabel, action.destructive && styles.menuDanger]} numberOfLines={1}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </AnchoredMenu>
    ) : (
      state && (
        <Modal transparent statusBarTranslucent visible animationType="fade" onRequestClose={() => (locked ? undefined : close(false))}>
          <Pressable style={styles.backdrop} onPress={() => (locked ? undefined : close(false))}>
            <Pressable style={styles.full} onPress={(e) => e.stopPropagation()}>
              <DialogCard
                title={state.options.title}
                message={state.options.message}
                compact={state.kind === 'confirm' && state.options.compact}>
                <DialogButtons
                  compact={state.kind === 'confirm' && state.options.compact}
                  cancelLabel={state.kind === 'confirm' ? (state.options.cancelLabel ?? t('common.cancel')) : undefined}
                  onCancel={() => close(false)}
                  confirmLabel={state.options.confirmLabel ?? t('common.confirm')}
                  onConfirm={() => close(true)}
                  destructive={state.kind === 'confirm' && state.options.destructive}
                />
              </DialogCard>
            </Pressable>
          </Pressable>
        </Modal>
      )
    );

  return { confirm, alert, sheet, dialog };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: palette.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  full: { width: '100%', alignItems: 'center' },
  menuTitle: { fontSize: 13, fontWeight: '700', color: palette.textMuted, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  menuRow: { minHeight: MENU_ROW, justifyContent: 'center', paddingHorizontal: 16 },
  menuPressed: { backgroundColor: palette.bgSoft },
  menuLabel: { fontSize: 16, fontWeight: '600', color: palette.text },
  menuDanger: { color: palette.danger },
});
