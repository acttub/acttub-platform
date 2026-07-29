import { useCallback, useRef, useState, type ReactElement } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';

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
};

type AlertOptions = { title: string; message?: string; confirmLabel?: string };

type SheetOptions = { title?: string; actions: DialogAction[]; cancelLabel?: string };

type DialogState =
  | { kind: 'confirm'; options: ConfirmOptions }
  | { kind: 'alert'; options: AlertOptions }
  | { kind: 'sheet'; options: SheetOptions }
  | null;

/**
 * OS 기본 Alert 대신 쓰는 앱 디자인 다이얼로그.
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
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {!!state.options.title && <Text style={styles.sheetTitle}>{state.options.title}</Text>}
            {state.options.actions.map((action, index) => (
              <Pressable
                key={action.label}
                style={({ pressed }) => [
                  styles.sheetItem,
                  index > 0 && styles.sheetItemDivided,
                  pressed && styles.pressed,
                ]}
                onPress={() => {
                  close(true);
                  action.onPress?.();
                }}>
                <Text style={[styles.sheetItemText, action.destructive && styles.destructiveText]}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]}
              onPress={() => close(false)}>
              <Text style={styles.sheetCancelText}>{state.options.cancelLabel ?? '취소'}</Text>
            </Pressable>
          </Pressable>
        ) : (
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>{state.options.title}</Text>
            {!!state.options.message && (
              <Text style={styles.message}>{state.options.message}</Text>
            )}
            <View style={styles.buttonRow}>
              {state.kind === 'confirm' && (
                <Pressable
                  style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}
                  onPress={() => close(false)}>
                  <Text style={styles.cancelText}>{state.options.cancelLabel ?? '취소'}</Text>
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  styles.confirm,
                  state.kind === 'confirm' && state.options.destructive && styles.confirmDanger,
                  pressed && styles.pressed,
                ]}
                onPress={() => close(true)}>
                <Text style={styles.confirmText}>{state.options.confirmLabel ?? '확인'}</Text>
              </Pressable>
            </View>
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
    backgroundColor: 'rgba(15, 21, 37, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  backdropSheet: { justifyContent: 'flex-end', padding: 12 },
  pressed: { opacity: 0.75 },

  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: palette.card,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
  },
  title: { fontSize: 17, fontWeight: '800', color: palette.text, textAlign: 'center' },
  message: {
    fontSize: 14,
    color: palette.textDim,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
  },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 22 },
  button: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancel: { backgroundColor: palette.bgSoft },
  cancelText: { fontSize: 15, fontWeight: '700', color: palette.textDim },
  confirm: { backgroundColor: palette.blue },
  confirmDanger: { backgroundColor: palette.danger },
  confirmText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },

  sheet: {
    width: '100%',
    backgroundColor: palette.card,
    borderRadius: 20,
    paddingVertical: 4,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.textFaint,
    textAlign: 'center',
    paddingVertical: 12,
  },
  sheetItem: { paddingVertical: 17, alignItems: 'center' },
  sheetItemDivided: { borderTopWidth: 1, borderTopColor: palette.border },
  sheetItemText: { fontSize: 16, fontWeight: '600', color: palette.text },
  destructiveText: { color: palette.danger },
  sheetCancel: {
    marginTop: 8,
    paddingVertical: 17,
    alignItems: 'center',
    backgroundColor: palette.bgSoft,
    borderRadius: 16,
  },
  sheetCancelText: { fontSize: 16, fontWeight: '800', color: palette.textDim },
});
