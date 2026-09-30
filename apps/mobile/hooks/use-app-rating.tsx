import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import {
  afterAsk,
  afterRated,
  parseRatingState,
  recordEvent,
  type RatingEvent,
} from '@/lib/app-rating';
import { translate as t } from '@/lib/i18n';
import { openStoreReview } from '@/lib/store-review';

const KEY = 'acttub.appRating';

async function load() {
  try {
    return parseRatingState(await AsyncStorage.getItem(KEY));
  } catch {
    return parseRatingState(null);
  }
}

async function save(state: ReturnType<typeof parseRatingState>) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 못 적어도 흐름은 그대로 — 다음에 한 번 더 물을 뿐이다
  }
}

/**
 * 앱 평가 요청 시트 (SOMA-494) — AI 코칭 2번·대본 완주 1번마다(7일 간격·최대 3번) 묻는다.
 *
 * `after(event, proceed)`: 사건을 세고, 물을 때가 아니면 곧바로 `proceed` 를 부른다. 물을 때면
 * 시트를 띄우고, 남기기·나중에 어느 쪽이든 닫힌 뒤 `proceed` 를 부른다.
 */
export function useAppRating() {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const proceedRef = useRef<(() => void) | null>(null);

  const close = useCallback(() => {
    setVisible(false);
    const proceed = proceedRef.current;
    proceedRef.current = null;
    proceed?.();
  }, []);

  const after = useCallback(async (event: RatingEvent, proceed?: () => void) => {
    const now = Date.now();
    const { state, ask } = recordEvent(await load(), event, now);
    if (!ask) {
      await save(state);
      proceed?.();
      return;
    }
    await save(afterAsk(state, now));
    proceedRef.current = proceed ?? null;
    logEvent('app_rating_prompt', { trigger: event.kind });
    setVisible(true);
  }, []);

  const rate = useCallback(async () => {
    await save(afterRated(await load()));
    logEvent('app_rating_accept', {});
    setVisible(false);
    await openStoreReview();
    close();
  }, [close]);

  const later = useCallback(() => {
    logEvent('app_rating_later', {});
    close();
  }, [close]);

  const element = (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={later}>
      <Pressable style={styles.backdrop} onPress={later} accessibilityRole="button">
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => undefined}>
          <View style={styles.handle} />
          <View style={styles.stars}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Ionicons key={i} name="star" size={30} color="#F5B324" />
            ))}
          </View>
          <Text style={styles.title}>{t('appRating.title')}</Text>
          <Text style={styles.body}>{t('appRating.body')}</Text>
          <Pressable style={styles.primary} onPress={() => void rate()} accessibilityRole="button">
            <Text style={styles.primaryText}>{t('appRating.rate')}</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={later} accessibilityRole="button">
            <Text style={styles.ghostText}>{t('appRating.later')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );

  return { after, element };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0F141E73', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: palette.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  handle: { width: 36, height: 4, borderRadius: 9999, backgroundColor: palette.border, marginVertical: 10 },
  stars: { flexDirection: 'row', gap: 6, marginTop: 10 },
  title: { fontSize: 21, fontWeight: '900', color: palette.text, letterSpacing: -0.5, marginTop: 14, textAlign: 'center' },
  body: { fontSize: 14, fontWeight: '600', color: palette.textMuted, lineHeight: 21, marginTop: 8, textAlign: 'center' },
  primary: {
    alignSelf: 'stretch',
    height: 54,
    borderRadius: 14,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  ghost: { alignSelf: 'stretch', height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  ghostText: { color: palette.textMuted, fontSize: 14.5, fontWeight: '700' },
});
