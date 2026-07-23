import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';
import { palette } from '@/constants/palette';

// Apple 로그인 모듈은 iOS에서만 로드 (안드로이드·재빌드 전 dev client에서 크래시 방지).
let AppleAuth: typeof import('expo-apple-authentication') | null = null;
if (Platform.OS === 'ios') {
  try {
    AppleAuth = require('expo-apple-authentication');
  } catch {
    AppleAuth = null;
  }
}

/**
 * 로그인 — 스플래시(흰 배경 + 중앙 로고) 톤을 이어받은 첫 화면.
 * Google 로그인만 제공. 로그인 성공 시 _layout 게이트가 자동으로 홈으로 보낸다.
 */
export default function LoginScreen() {
  const { signInWithGoogle, signInWithApple } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (AppleAuth) AppleAuth.isAvailableAsync().then(setAppleAvailable).catch(() => {});
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했어요. 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = () => run(signInWithGoogle);

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.hero}>
        <Image
          source={require('@/assets/images/logo-wordmark.png')}
          style={styles.logo}
          contentFit="contain"
        />
        <Text style={styles.tagline}>점수가 아니라, 그 장면에서 뭘 하려 했는지</Text>
      </View>

      <View style={styles.bottom}>
        <Pressable
          style={[styles.googleButton, busy && styles.googleButtonBusy]}
          onPress={onGoogle}
          disabled={busy}>
          {busy ? (
            <ActivityIndicator color={palette.text} />
          ) : (
            <>
              <View style={styles.googleG}>
                <Text style={styles.googleGText}>G</Text>
              </View>
              <Text style={styles.googleText}>Google로 계속하기</Text>
            </>
          )}
        </Pressable>

        {appleAvailable && AppleAuth && (
          <AppleAuth.AppleAuthenticationButton
            buttonType={AppleAuth.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuth.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={16}
            style={styles.appleButton}
            onPress={() => run(signInWithApple)}
          />
        )}

        {error && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.legal}>계속하면 서비스 약관과 개인정보 처리방침에 동의하게 돼요.</Text>
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
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: palette.border,
    borderRadius: 16,
    height: 56,
    shadowColor: palette.navy,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  googleButtonBusy: { opacity: 0.7 },
  appleButton: { width: '100%', height: 56 },
  googleG: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleGText: { fontSize: 16, fontWeight: '800', color: '#4285F4' },
  googleText: { fontSize: 16, fontWeight: '700', color: palette.text },
  error: { color: palette.danger, fontSize: 13, textAlign: 'center' },
  legal: { color: palette.textFaint, fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
