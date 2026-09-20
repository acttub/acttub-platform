import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import {
  DEFAULT_MEMORY_CHOICE,
  TRANSFER_CODE_LENGTH,
  createGuestTransfer,
  formatTransferCodeInput,
  isTransferCodeComplete,
  type MemoryChoice,
  type TransferOutcome,
} from '@/lib/guest-transfer';
import { translate as t } from '@/lib/i18n';

/**
 * 이관 코드 입력 — 웹에서 로그인 없이 해 본 연습·대본을 이 계정으로 가져온다.
 *
 * 웹이 보여 준 여섯 자리 코드를 넣으면 서버가 게스트 자료의 주인을 이 회원으로 바꾼다. 나와
 * 게스트 둘 다 배우 기억이 있으면 어느 쪽을 둘지 팝업에서 고른다 — 고르기 전에는 아무것도
 * 옮겨지지 않고, 팝업을 닫으면 없던 일이 된다(같은 코드를 10분 안에 다시 쓸 수 있다).
 * 옮긴 뒤에는 다른 코드를 이어서 넣을 수 있다 — 한 계정이 게스트 여럿을 차례로 받는다.
 */
export default function GuestTransferScreen() {
  const router = useRouter();
  const [transfer] = useState(() => createGuestTransfer({ send: (body) => api.transferGuestData(body) }));
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [choice, setChoice] = useState<MemoryChoice>(DEFAULT_MEMORY_CHOICE);

  const handle = (outcome: TransferOutcome) => {
    switch (outcome.kind) {
      case 'transferred':
        setChoosing(false);
        setDone(true);
        return;
      case 'memory_choice_required':
        setChoice(DEFAULT_MEMORY_CHOICE);
        setChoosing(true);
        return;
      case 'code_not_found':
        setError(t('guestTransfer.codeNotFound'));
        break;
      case 'rate_limited':
        setError(t('guestTransfer.rateLimited'));
        break;
      case 'client_bug':
        setError(t('guestTransfer.appBug'));
        break;
      default:
        setError(outcome.message ?? t('guestTransfer.fail'));
    }
    setChoosing(false);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    handle(await transfer.submit(code));
    setBusy(false);
  };

  const confirmChoice = async () => {
    setBusy(true);
    setError(null);
    handle(await transfer.choose(choice));
    setBusy(false);
  };

  // 팝업을 닫으면 요청을 보내지 않는다. 아무것도 옮겨지지 않았고 코드는 살아 있다.
  const dismissChoice = () => {
    if (busy) return;
    transfer.dismiss();
    setChoosing(false);
  };

  const enterAnother = () => {
    setCode('');
    setError(null);
    setDone(false);
  };

  const ready = isTransferCodeComplete(code);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('guestTransfer.title') }} />
      {done ? (
        <View style={styles.content}>
          <View style={styles.doneIcon}>
            <Feather name="check" size={26} color={palette.blue} />
          </View>
          <Text style={styles.heading}>{t('guestTransfer.doneTitle')}</Text>
          <Text style={styles.body}>{t('guestTransfer.doneBody')}</Text>
          {/* 목록은 화면이 열릴 때마다 서버에서 다시 받는다. 기록으로 보내면 옮긴 연습이 보인다. */}
          <Pressable
            style={styles.cta}
            onPress={() => router.replace('/(tabs)/history')}
            accessibilityRole="button">
            <Text style={styles.ctaText}>{t('guestTransfer.seeHistory')}</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={enterAnother} accessibilityRole="button">
            <Text style={styles.ghostText}>{t('guestTransfer.another')}</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAwareScroll contentContainerStyle={styles.content}>
          <Text style={styles.heading}>{t('guestTransfer.heading')}</Text>
          <Text style={styles.body}>{t('guestTransfer.body')}</Text>
          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={(text) => {
              setCode(formatTransferCodeInput(text));
              setError(null);
            }}
            placeholder={'0'.repeat(TRANSFER_CODE_LENGTH)}
            placeholderTextColor={palette.checkOff}
            keyboardType="number-pad"
            maxLength={TRANSFER_CODE_LENGTH}
            autoFocus
            accessibilityLabel={t('guestTransfer.codeLabel')}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={[styles.cta, (!ready || busy) && styles.disabled]}
            onPress={() => void submit()}
            disabled={!ready || busy}
            accessibilityRole="button">
            {busy && !choosing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.ctaText}>{t('guestTransfer.cta')}</Text>
            )}
          </Pressable>
          <Text style={styles.hint}>{t('guestTransfer.hint')}</Text>
        </KeyboardAwareScroll>
      )}

      {/* 기억 선택 팝업 — 기본은 회원 것이고 고른 쪽만 남는다. */}
      <Modal visible={choosing} transparent animationType="fade" onRequestClose={dismissChoice}>
        <Pressable style={styles.backdrop} onPress={dismissChoice} accessibilityRole="button" />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{t('guestTransfer.memoryTitle')}</Text>
          <Text style={styles.body}>{t('guestTransfer.memoryBody')}</Text>
          <View accessibilityRole="radiogroup" style={styles.options}>
            {(['member', 'guest'] as MemoryChoice[]).map((option) => {
              const selected = choice === option;
              return (
                <Pressable
                  key={option}
                  style={[styles.option, selected && styles.optionOn]}
                  onPress={() => setChoice(option)}
                  disabled={busy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: busy }}>
                  <Feather
                    name={selected ? 'check-circle' : 'circle'}
                    size={18}
                    color={selected ? palette.blue : palette.checkOff}
                  />
                  <View style={styles.optionBody}>
                    <Text style={styles.optionTitle}>
                      {t(option === 'member' ? 'guestTransfer.memoryMember' : 'guestTransfer.memoryGuest')}
                    </Text>
                    <Text style={styles.hint}>
                      {t(
                        option === 'member'
                          ? 'guestTransfer.memoryMemberSub'
                          : 'guestTransfer.memoryGuestSub',
                      )}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.modalActions}>
            <Pressable style={styles.modalBtn} onPress={dismissChoice} disabled={busy} accessibilityRole="button">
              <Text style={styles.modalBtnText}>{t('guestTransfer.memoryClose')}</Text>
            </Pressable>
            <Pressable
              style={[styles.modalBtn, styles.modalBtnPrimary, busy && styles.disabled]}
              onPress={() => void confirmChoice()}
              disabled={busy}
              accessibilityRole="button">
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>
                  {t('guestTransfer.memoryConfirm')}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  content: { flexGrow: 1, padding: 24, gap: 14 },
  heading: { fontSize: 22, fontWeight: '800', color: palette.text, lineHeight: 30 },
  body: { fontSize: 14, lineHeight: 21, color: palette.textDim },
  hint: { fontSize: 12.5, lineHeight: 18, color: palette.textFaint },
  codeInput: {
    marginTop: 8,
    backgroundColor: palette.bgSoft,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    color: palette.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 8,
    textAlign: 'center',
  },
  error: { color: palette.danger, fontSize: 13.5, textAlign: 'center' },
  cta: { backgroundColor: palette.blue, borderRadius: 16, padding: 17, alignItems: 'center', marginTop: 4 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  ghost: { paddingVertical: 14, alignItems: 'center' },
  ghostText: { color: palette.textDim, fontSize: 14.5, fontWeight: '700' },
  doneIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: '22%',
    backgroundColor: palette.card,
    borderRadius: 18,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  options: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    padding: 14,
  },
  optionOn: { borderColor: palette.blue, backgroundColor: palette.blueSoft },
  optionBody: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 14.5, fontWeight: '800', color: palette.text },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  modalBtn: { minWidth: 72, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10 },
  modalBtnPrimary: { backgroundColor: palette.blue },
  modalBtnText: { fontSize: 14, fontWeight: '700', color: palette.textDim },
  modalBtnTextPrimary: { color: '#FFFFFF' },
});
