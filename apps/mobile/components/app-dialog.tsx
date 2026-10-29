import type Feather from '@expo/vector-icons/Feather';
import { useCallback, useRef, useState, type ComponentProps, type ReactElement } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { AnchoredMenu, MENU_ITEM_HEIGHT, MENU_PAD, MenuItem, type MenuAnchor } from '@/components/ui/anchored-menu';
import { DialogButtons, DialogCard } from '@/components/ui/dialog';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

export type DialogAction = {
  label: string;
  onPress?: () => void;
  /** 빨간 글씨 — 되돌릴 수 없는 동작. */
  destructive?: boolean;
  /** 고른 값(언어 등) — blue-deep 글자 + 체크. */
  selected?: boolean;
  /** 글자 앞 아이콘(「제목 수정」 연필·「대본 삭제」 휴지통, 18). 빨간 줄이면 아이콘도 빨갛다. */
  icon?: ComponentProps<typeof Feather>['name'];
};

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** 바깥·뒤로가기로 닫히지 않고 두 버튼으로만 답한다(공개 범위처럼 실수로 넘기면 안 되는 결정). */
  locked?: boolean;
};

type AlertOptions = { title: string; message?: string; confirmLabel?: string };

/** 누른 자리 근처에 뜨는 작은 메뉴. anchor 는 누른 점(화면 좌표)이고, 없으면 오른쪽 위에 뜬다. */
type SheetOptions = { title?: string; actions: DialogAction[]; anchor?: MenuAnchor };

type DialogState =
  | { kind: 'confirm'; options: ConfirmOptions }
  | { kind: 'alert'; options: AlertOptions }
  | { kind: 'sheet'; options: SheetOptions }
  | null;

/**
 * OS 기본 Alert 대신 쓰는 앱 디자인 다이얼로그. 확인·경고는 components/ui/dialog(pen Dialog), 선택지는 anchored-menu(pen Menu).
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
        estimatedHeight={state.options.actions.length * MENU_ITEM_HEIGHT + MENU_PAD * 2 + (state.options.title ? 36 : 0)}
        onClose={() => close(false)}>
        {state.options.title ? (
          <Text style={styles.menuTitle} numberOfLines={1}>
            {state.options.title}
          </Text>
        ) : null}
        {state.options.actions.map((action) => (
          <MenuItem
            key={action.label}
            label={action.label}
            icon={action.icon}
            destructive={action.destructive}
            selected={action.selected}
            onPress={() => {
              close(true);
              action.onPress?.();
            }}
          />
        ))}
      </AnchoredMenu>
    ) : (
      state && (
        <Modal transparent statusBarTranslucent visible animationType="fade" onRequestClose={() => (locked ? undefined : close(false))}>
          <Pressable style={styles.backdrop} onPress={() => (locked ? undefined : close(false))}>
            <Pressable style={styles.full} onPress={(e) => e.stopPropagation()}>
              <DialogCard title={state.options.title} message={state.options.message}>
                <DialogButtons
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
    padding: space.gutter,
  },
  full: { width: '100%', alignItems: 'center' },
  menuTitle: { ...type.captionBold, color: palette.textMeta, paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[1] },
});
