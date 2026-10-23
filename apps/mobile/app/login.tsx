import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { TextButton } from '@/components/ui/buttons';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { palette } from '@/constants/palette';
import { recordHandledError } from '@/lib/crashlytics';
import { translate as t } from '@/lib/i18n';
import { lastProviderStore } from '@/lib/last-provider';
import {
  emailConflictDialog,
  highlightedProvider,
  providerLabel,
  visibleLoginProviders,
  type LoginProvider,
} from '@/lib/login-flow';
import { supportedProviders } from '@/lib/provider-sdk';

// 애플 로고는 SF Symbols의 공식 심볼(apple.logo)을 쓴다. 네이티브 모듈이 없는 옛 dev client에서도
// 화면이 뜨도록 가드해서 로드하고, 없으면 시스템 폰트의 애플 글리프로 대체한다.
let SymbolView: typeof import('expo-symbols').SymbolView | null = null;
try {
  SymbolView = (require('expo-symbols') as typeof import('expo-symbols')).SymbolView;
} catch {
  SymbolView = null;
}

// 구글 로그인 버튼 라이트 테마 규격 색(브랜드 가이드).
const GOOGLE_BORDER = '#DADCE0';
const GOOGLE_TEXT = '#1F1F1F';
// 카카오·네이버 로그인 버튼 규격 색(각 브랜드 가이드).
const KAKAO_YELLOW = '#FEE500';
const KAKAO_TEXT = '#191919';
const KAKAO_SYMBOL = '#000000';
const NAVER_GREEN = '#03C75A';

type ProviderList =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; providers: LoginProvider[] };

/**
 * A0 로그인 — 스플래시(흰 배경 + 중앙 로고) 톤을 이어받은 첫 화면.
 *
 * 버튼은 서버가 켜 둔 제공자 중 이 빌드가 지원하는 것만 그린다(안드로이드는 애플 제외).
 * 지난번에 쓴 제공자 버튼에는 "최근 로그인" 표시를 붙인다. 로그인에 성공하면 _layout
 * 게이트가 다음 화면(처음이면 동의, 아니면 홈)으로 보낸다.
 */
export default function LoginScreen() {
  const { signInWith, loginNotice, clearLoginNotice } = useAuth();
  const [list, setList] = useState<ProviderList>({ status: 'loading' });
  const [lastProvider, setLastProvider] = useState<LoginProvider | null>(null);
  const [busy, setBusy] = useState<LoginProvider | null>(null);
  const [failed, setFailed] = useState(false);
  const { confirm, alert, dialog } = useAppDialog();

  const loadProviders = useCallback(async () => {
    setList({ status: 'loading' });
    try {
      const [{ providers: enabled }, supported] = await Promise.all([
        api.authProviders(),
        supportedProviders(),
      ]);
      setList({
        status: 'ready',
        providers: visibleLoginProviders({ enabled, supported, platform: Platform.OS }),
      });
    } catch {
      setList({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void loadProviders();
    void lastProviderStore.read().then(setLastProvider);
  }, [loadProviders]);

  const run = useCallback(
    async (provider: LoginProvider) => {
      setFailed(false);
      clearLoginNotice();
      setBusy(provider);
      try {
        await signInWith(provider);
      } catch (err) {
        // 화면에는 한 문장만 보이므로 원인은 크래시 리포트에 남긴다.
        setFailed(true);
        recordHandledError(err);
        // 꺼 둔 제공자(400)였을 수 있다. 목록을 다시 받아 버튼을 새로 그린다.
        if ((err as { code?: string })?.code === 'unsupported_provider') void loadProviders();
      } finally {
        setBusy(null);
      }
    },
    [clearLoginNotice, loadProviders, signInWith],
  );

  // 이메일 겹침은 로그인·가입 제출 어느 쪽에서 와도 이 화면 위 팝업으로 묻는다.
  const conflictProvider =
    loginNotice?.kind === 'email_conflict' ? loginNotice.provider : undefined;
  useEffect(() => {
    if (conflictProvider === undefined) return;
    clearLoginNotice();
    void (async () => {
      const supported = await supportedProviders();
      const { title, message, continueWith } = emailConflictDialog(conflictProvider, supported);
      if (!continueWith) {
        await alert({ title, message });
        return;
      }
      const accepted = await confirm({
        title,
        message,
        cancelLabel: t('common.close'),
        confirmLabel: t('login.emailConflictContinue', { provider: providerLabel(continueWith) }),
      });
      if (accepted) void run(continueWith);
    })();
  }, [alert, clearLoginNotice, confirm, conflictProvider, run]);

  const providers = list.status === 'ready' ? list.providers : [];
  const highlighted = highlightedProvider(providers, lastProvider);

  // pen S3.4 — 제공자는 지름 60 동그라미 한 줄(Apple · Google · 카카오 · 네이버). 글자는 접근성 이름에만 둔다.
  const renderButton = (provider: LoginProvider) => {
    const label = t(`login.${provider}`);
    const isLast = highlighted === provider;
    const look = BUTTON_LOOK[provider];
    return (
      <Pressable
        key={provider}
        style={({ pressed }) => [styles.circle, look.button, pressed && styles.pressed, busy !== null && styles.dim]}
        onPress={() => void run(provider)}
        disabled={busy !== null}
        accessibilityRole="button"
        accessibilityLabel={isLast ? t('login.lastUsedA11y', { label }) : label}>
        {provider === 'google' && (
          // 구글이 배포하는 공식 로고 에셋(GoogleSignIn SDK). 직접 그리면 심사에서 막힌다.
          <Image source={require('@/assets/images/google-logo.png')} style={styles.googleLogo} contentFit="contain" />
        )}
        {provider === 'apple' &&
          (SymbolView ? (
            <SymbolView name="apple.logo" tintColor="#FFFFFF" size={26} />
          ) : (
            <Text style={styles.appleGlyph}></Text>
          ))}
        {provider === 'kakao' && <KakaoSymbol />}
        {provider === 'naver' && <Text style={styles.naverN}>N</Text>}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.hero}>
        <Image
          source={require('@/assets/images/logo-wordmark.png')}
          style={styles.logo}
          contentFit="contain"
        />
        <Text style={styles.tagline}>{t('login.tagline')}</Text>
        {busy !== null && (
          <View style={styles.progress} accessibilityRole="progressbar">
            <ActivityIndicator size="small" color={palette.textMuted} />
            <Text style={styles.progressText}>{t('login.signingIn')}</Text>
          </View>
        )}
      </View>

      <View style={styles.bottom}>
        {loginNotice?.kind === 'notice' && (
          <Text style={styles.notice}>{loginNotice.message}</Text>
        )}
        {failed && (
          <View style={styles.failBox} accessibilityRole="alert">
            <Feather name="help-circle" size={20} color={palette.danger} />
            <Text style={styles.failText}>{t('login.failed')}</Text>
          </View>
        )}

        {list.status === 'loading' ? (
          <ActivityIndicator color={palette.blue} />
        ) : list.status === 'error' ? (
          <View style={styles.reloadBox}>
            <Text style={styles.error}>{t('login.providersFail')}</Text>
            {/* pen S3.2 — 빨간 한 줄 아래 파란 글자 링크(간격 4). */}
            <TextButton tone="accent" label={t('login.reload')} onPress={() => void loadProviders()} />
          </View>
        ) : providers.length === 0 ? (
          <Text style={styles.error}>{t('login.providersEmpty')}</Text>
        ) : (
          <View style={styles.circleRow}>{providers.map(renderButton)}</View>
        )}
      </View>
      {dialog}
    </SafeAreaView>
  );
}

/** 카카오 로그인 버튼 가이드의 심볼(검은 말풍선). 아이콘 글꼴에 같은 모양이 없어 도형으로 그린다. */
function KakaoSymbol() {
  return (
    <View style={styles.kakaoSymbol}>
      <View style={styles.kakaoBubble} />
      <View style={styles.kakaoTail} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg, paddingHorizontal: 24 },
  hero: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  logo: { width: 190, height: 76 },
  tagline: { fontSize: 15, fontWeight: '500', color: palette.textDim, textAlign: 'center', lineHeight: 22 },
  // 로그인하는 중 — 돌림 표시와 한 줄 문구.
  progress: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 56 },
  progressText: { fontSize: 14, fontWeight: '500', color: palette.textMuted },
  bottom: { paddingBottom: 28, gap: 20 },
  // 켜진 제공자 수(2~4개)와 상관없이 가운데에 모은다 — 둘일 때 양 끝으로 벌어지지 않게.
  circleRow: { flexDirection: 'row', justifyContent: 'center', gap: 20 },
  circle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  googleLogo: { width: 26, height: 26 },
  naverN: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  kakaoSymbol: { width: 26, height: 25 },
  kakaoBubble: { width: 26, height: 21, borderRadius: 13, backgroundColor: KAKAO_SYMBOL },
  kakaoTail: {
    position: 'absolute',
    left: 6,
    top: 17,
    width: 0,
    height: 0,
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: KAKAO_SYMBOL,
    transform: [{ rotate: '25deg' }],
  },
  pressed: { opacity: 0.7 },
  dim: { opacity: 0.5 },
  appleGlyph: { fontFamily: 'System', fontSize: 26, color: '#FFFFFF' },
  notice: {
    color: palette.text,
    backgroundColor: palette.bgSubtle,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
  },
  // 로그인 실패 — 옅은 빨강 칸에 물음표 아이콘과 두 줄 문구(pen S3.8b).
  failBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.dangerSoft,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  failText: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.danger },
  reloadBox: { alignItems: 'center', gap: 4 },
  error: { color: palette.danger, fontSize: 13, textAlign: 'center' },
});

/** 제공자별 버튼 모양. 각 브랜드 가이드의 규격 색을 지킨다. */
const BUTTON_LOOK: Record<
  LoginProvider,
  { button: object; text: object; spinner: string }
> = {
  google: {
    button: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: GOOGLE_BORDER },
    text: { color: GOOGLE_TEXT },
    spinner: GOOGLE_TEXT,
  },
  apple: {
    button: { backgroundColor: '#000000' },
    text: { color: '#FFFFFF' },
    spinner: '#FFFFFF',
  },
  kakao: {
    button: { backgroundColor: KAKAO_YELLOW },
    text: { color: KAKAO_TEXT },
    spinner: KAKAO_TEXT,
  },
  naver: {
    button: { backgroundColor: NAVER_GREEN },
    text: { color: '#FFFFFF' },
    spinner: '#FFFFFF',
  },
};
