import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { palette } from '@/constants/palette';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';

export default function ProfileNameScreen() {
  const { completeProfileSetup } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyboardHeight = useKeyboardHeight();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await completeProfileSetup(name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('profileName.fail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={keyboardHeight > 0 ? ['top'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <KeyboardAwareScroll
          contentContainerStyle={styles.content}
          automaticallyAdjustKeyboardInsets={false}>
          <View>
            <Text style={styles.title}>{t('profileName.title')}</Text>
            <Text style={styles.subtitle}>{t('profileName.subtitle')}</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder={t('profileName.placeholder')}
            placeholderTextColor={palette.textDim}
            value={name}
            onChangeText={setName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => {
              if (name.trim() && !busy) void submit();
            }}
          />
          {error && <Text style={styles.error}>{error}</Text>}
        </KeyboardAwareScroll>
        <Pressable
          style={[styles.cta, (!name.trim() || busy) && styles.ctaDisabled]}
          onPress={() => void submit()}
          disabled={!name.trim() || busy}>
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.ctaText}>{t('profileName.cta')}</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 48, gap: 24 },
  title: { fontSize: 24, fontWeight: '800', color: palette.text },
  subtitle: { marginTop: 8, fontSize: 14, lineHeight: 20, color: palette.textDim },
  input: {
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    padding: 14,
    color: palette.text,
    fontSize: 15,
  },
  error: { color: palette.danger, fontSize: 13 },
  cta: {
    backgroundColor: palette.blue,
    borderRadius: 16,
    padding: 17,
    alignItems: 'center',
    margin: 20,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
