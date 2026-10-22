import { useCallback, useRef, useState, type ReactElement } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheetCard, DialogButtons, DialogCard } from '@/components/ui/dialog';
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
};

type AlertOptions = { title: string; message?: string; confirmLabel?: string };

type SheetOptions = { title?: string; actions: DialogAction[]; cancelLabel?: string };

type DialogState =
  | { kind: 'confirm'; options: ConfirmOptions }
  | { kind: 'alert'; options: AlertOptions }
  | { kind: 'sheet'; options: SheetOptions }
  | null;

/**
 * OS 기본 Alert 대신 쓰는 앱 디자인 다이얼로그. 모양은 공통 부품 components/ui/dialog(pen Dialog/Confirm·ActionSheet).
 *
 * 기본 Alert는 안드로이드·iOS가 서로 다른 모양으로 그리고 앱 톤과 따로 논다.
 * 확인/경고는 가운데 카드, 선택지는 하단 시트로 통일한다.
 *
 * 사용법:
 *   const { confirm, alert, sheet, dialog } = useAppDialog();
 *   if (await confirm({ title: '삭제할까요?', destructive: true })) { ... }
 *   ...
 *   return (<View>...{dialog}</View>);
 */
export function useAppDialog() {
  const insets = useSafeAreaInsets();
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

  const dialog: ReactElement | null = state && (
    <Modal
      transparent
      statusBarTranslucent
      visible
      animationType={state.kind === 'sheet' ? 'slide' : 'fade'}
      onRequestClose={() => close(false)}>
      <Pressable
        style={[
          styles.backdrop,
          state.kind === 'sheet' && styles.backdropSheet,
          state.kind === 'sheet' && { paddingBottom: 12 + insets.bottom },
        ]}
        onPress={() => close(false)}>
        {state.kind === 'sheet' ? (
          <Pressable style={styles.full} onPress={(e) => e.stopPropagation()}>
            <ActionSheetCard
              title={state.options.title}
              items={state.options.actions.map((action) => ({
                label: action.label,
                destructive: action.destructive,
                onPress: () => {
                  close(true);
                  action.onPress?.();
                },
              }))}
              cancelLabel={state.options.cancelLabel ?? t('common.cancel')}
              onCancel={() => close(false)}
            />
          </Pressable>
        ) : (
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
        )}
      </Pressable>
    </Modal>
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
  backdropSheet: { justifyContent: 'flex-end', padding: 12 },
  full: { width: '100%', alignItems: 'center' },
});
