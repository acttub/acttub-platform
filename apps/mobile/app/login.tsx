import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import { lastProviderStore } from '@/lib/last-provider';
import {
  highlightedProvider,
  loginErrorMessage,
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
  const { signInWith, continueAsGuest, loginNotice, clearLoginNotice } = useAuth();
  const [list, setList] = useState<ProviderList>({ status: 'loading' });
  const [lastProvider, setLastProvider] = useState<LoginProvider | null>(null);
  const [busy, setBusy] = useState<LoginProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const run = async (provider: LoginProvider) => {
    setError(null);
    clearLoginNotice();
    setBusy(provider);
    try {
      await signInWith(provider);
    } catch (err) {
      setError(loginErrorMessage(err));
      // 꺼 둔 제공자(400)였을 수 있다. 목록을 다시 받아 버튼을 새로 그린다.
      if ((err as { code?: string })?.code === 'unsupported_provider') void loadProviders();
    } finally {
      setBusy(null);
    }
  };

  const providers = list.status === 'ready' ? list.providers : [];
  const highlighted = highlightedProvider(providers, lastProvider);

  const renderButton = (provider: LoginProvider) => {
    const label = t(`login.${provider}`);
    const isLast = highlighted === provider;
    const look = BUTTON_LOOK[provider];
    return (
      <View key={provider}>
        <Pressable
          style={({ pressed }) => [styles.button, look.button, pressed && styles.pressed]}
          onPress={() => void run(provider)}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel={isLast ? t('login.lastUsedA11y', { label }) : label}>
          {busy === provider ? (
            <ActivityIndicator color={look.spinner} />
          ) : (
            <>
              {provider === 'google' && (
                // 구글이 배포하는 공식 로고 에셋(GoogleSignIn SDK). 직접 그리면 심사에서 막힌다.
                <Image
                  source={require('@/assets/images/google-logo.png')}
                  style={styles.googleLogo}
                  contentFit="contain"
                />
              )}
              {provider === 'apple' &&
                // 공식 AppleAuthenticationButton은 글자 크기를 버튼 높이에 비례해 정해서(약 0.35배)
                // 다른 버튼과 크기를 맞출 수 없다. HIG가 허용하는 커스텀 버튼으로 직접 그린다 —
                // 공식 로고(SF Symbols apple.logo)·승인 문구·검정 배경 규격은 그대로 지킨다.
                (SymbolView ? (
                  <SymbolView name="apple.logo" tintColor="#FFFFFF" size={23} />
                ) : (
                  <Text style={styles.appleGlyph}></Text>
                ))}
              <Text style={[styles.buttonText, look.text]}>{label}</Text>
            </>
          )}
        </Pressable>
        {isLast && (
          <View style={styles.lastBadge} pointerEvents="none">
            <Text style={styles.lastBadgeText}>{t('login.lastUsed')}</Text>
          </View>
        )}
      </View>
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
      </View>

      <View style={styles.bottom}>
        {loginNotice && <Text style={styles.notice}>{loginNotice}</Text>}

        {list.status === 'loading' ? (
          <ActivityIndicator color={palette.blue} />
        ) : list.status === 'error' ? (
          <View style={styles.reloadBox}>
            <Text style={styles.error}>{t('login.providersFail')}</Text>
            <Pressable style={styles.reload} onPress={() => void loadProviders()} accessibilityRole="button">
              <Text style={styles.reloadText}>{t('login.reload')}</Text>
            </Pressable>
          </View>
        ) : providers.length === 0 ? (
          <Text style={styles.error}>{t('login.providersEmpty')}</Text>
        ) : (
          providers.map(renderButton)
        )}

        {error && <Text style={styles.error}>{error}</Text>}
        {/* 로그인 없이 둘러보기 — 계정이 있어야 하는 자리는 useRequireLogin 이 따로 막는다 (SOMA-544). */}
        <Pressable
          style={({ pressed }) => [styles.guestButton, pressed && styles.guestPressed]}
          onPress={() => void continueAsGuest()}
          accessibilityRole="button">
          <Text style={styles.guestText}>{t('login.guest')}</Text>
        </Pressable>
        <Text style={styles.legal}>{t('login.legal')}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg, paddingHorizontal: 28 },
  hero: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  logo: { width: 220, height: 88 },
  tagline: { fontSize: 15, color: palette.textDim, textAlign: 'center', lineHeight: 22 },
  bottom: { paddingBottom: 28, gap: 14 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 56,
    borderRadius: 16,
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  googleLogo: { width: 20, height: 20 },
  pressed: { opacity: 0.7 },
  appleGlyph: { fontFamily: 'System', fontSize: 21, color: '#FFFFFF' },
  // 지난번에 쓴 제공자 — 버튼 오른쪽 위에 걸치는 작은 표시.
  lastBadge: {
    position: 'absolute',
    top: -9,
    right: 14,
    backgroundColor: palette.blue,
    borderRadius: 9999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  lastBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
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
  reloadBox: { alignItems: 'center', gap: 4 },
  reload: { paddingHorizontal: 16, paddingVertical: 8 },
  reloadText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  error: { color: palette.danger, fontSize: 13, textAlign: 'center' },
  legal: { color: palette.textFaint, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  guestButton: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  guestPressed: { opacity: 0.6 },
  guestText: { color: palette.textDim, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
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
    button: { backgroundColor: '#000000', gap: 8 },
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
