import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { PrimaryButton, TextButton } from '@/components/ui/buttons';
import { Checkbox } from '@/components/ui/checkbox';
import { CtaBar } from '@/components/ui/cta-bar';
import { DialogButtons } from '@/components/ui/dialog';
import { NavBackButton, NavHeader } from '@/components/ui/nav-header';
import { TextField } from '@/components/ui/text-field';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader
        title={t('guestTransfer.title')}
        left={<NavBackButton onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />}
      />
      {done ? (
        <>
          <View style={styles.doneBody}>
            <View style={styles.doneIcon}>
              <Feather name="check" size={36} color={palette.blue} />
            </View>
            <Text style={[styles.heading, styles.center]}>{t('guestTransfer.doneTitle')}</Text>
            <Text style={[styles.body, styles.center]}>{t('guestTransfer.doneBody')}</Text>
          </View>
          <CtaBar safeBottom={false}>
            <TextButton label={t('guestTransfer.another')} onPress={enterAnother} />
            {/* 목록은 화면이 열릴 때마다 서버에서 다시 받는다. 기록으로 보내면 옮긴 연습이 보인다. */}
            <PrimaryButton label={t('guestTransfer.seeHistory')} onPress={() => router.dismissTo('/(tabs)/history')} />
          </CtaBar>
        </>
      ) : (
        <KeyboardAwareScroll contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}>
            <Text style={styles.heading}>{t('guestTransfer.heading')}</Text>
            <Text style={styles.body}>{t('guestTransfer.body')}</Text>
          </View>
          <TextField
            style={styles.codeInput}
            value={code}
            error={error}
            onChangeText={(text) => {
              setCode(formatTransferCodeInput(text));
              setError(null);
            }}
            placeholder={'0'.repeat(TRANSFER_CODE_LENGTH)}
            placeholderTextColor={palette.textDisabled}
            keyboardType="number-pad"
            maxLength={TRANSFER_CODE_LENGTH}
            autoFocus
            accessibilityLabel={t('guestTransfer.codeLabel')}
          />
          <PrimaryButton
            label={t('guestTransfer.cta')}
            onPress={() => void submit()}
            disabled={!ready || (busy && choosing)}
            loading={busy && !choosing}
            loadingLabel={t('guestTransfer.submitting')}
          />
          <Text style={styles.hint}>{t('guestTransfer.hint')}</Text>
        </KeyboardAwareScroll>
      )}

      {/* 기억 선택 팝업 — 기본은 회원 것이고 고른 쪽만 남는다. */}
      <Modal visible={choosing} transparent statusBarTranslucent animationType="fade" onRequestClose={dismissChoice}>
        <View style={styles.scrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismissChoice} accessibilityRole="button" />
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{t('guestTransfer.memoryTitle')}</Text>
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
                    <Checkbox checked={selected} />
                    <View style={styles.optionBody}>
                      <Text style={[styles.optionTitle, selected && styles.optionTitleOn]}>
                        {t(option === 'member' ? 'guestTransfer.memoryMember' : 'guestTransfer.memoryGuest')}
                      </Text>
                      <Text style={styles.hint}>
                        {t(option === 'member' ? 'guestTransfer.memoryMemberSub' : 'guestTransfer.memoryGuestSub')}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <DialogButtons
              cancelLabel={t('guestTransfer.memoryClose')}
              onCancel={dismissChoice}
              confirmLabel={t('guestTransfer.memoryConfirm')}
              onConfirm={() => void confirmChoice()}
              busy={busy}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  content: { flexGrow: 1, paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[6], gap: space[4] },
  titleBlock: { gap: space[1.5] },
  heading: { ...type.title2, color: palette.text },
  body: { ...type.body2, color: palette.textSub },
  hint: { ...type.caption, color: palette.textMeta },
  center: { textAlign: 'center' },
  codeInput: { height: 64, ...type.title1, lineHeight: undefined, letterSpacing: 4, textAlign: 'center' },
  doneBody: { flex: 1, alignItems: 'center', gap: space[3], paddingTop: 140, paddingHorizontal: space.gutter },
  doneIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: space.gutter },
  dialog: { width: '100%', backgroundColor: palette.bg, borderRadius: radius.xl, padding: space[6], gap: space[4] },
  dialogTitle: { ...type.headline, color: palette.text },
  options: { gap: space[2] },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  optionOn: { borderWidth: 1.5, borderColor: palette.blue, backgroundColor: palette.blueSoft, padding: space[4] - 0.5 },
  optionBody: { flex: 1 },
  optionTitle: { ...type.body1Bold, color: palette.text },
  optionTitleOn: { color: palette.blueDeep },
});
