import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
 * 앱 평가 요청 카드 (SOMA-494, SOMA-821에서 아래 시트를 화면 안 카드로 바꿨다) — AI 코칭 2번·대본 완주 2번마다(7일 간격·최대 3번) 묻는다.
 *
 * `after(event, proceed)`: 사건을 세고, 물을 때가 아니면 곧바로 `proceed` 를 부른다. 물을 때면
 * 카드를 보이고, 남기기·나중에 어느 쪽이든 카드가 접힌 뒤 `proceed` 를 부른다.
 * `element` 는 팝업이 아니라 부르는 화면이 스크롤 안 알맞은 자리(완료·정리 내용 아래)에 끼워 넣는 인라인 카드다. 안 물을 땐 null.
 */
export function useAppRating() {
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

  const element = visible ? (
    <View style={styles.card} testID="app-rating-card">
      <View style={styles.stars}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Ionicons key={i} name="star" size={26} color="#F5B324" />
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
    </View>
  ) : null;

  return { after, element };
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 20,
    marginTop: 16,
  },
  stars: { flexDirection: 'row', gap: 6 },
  title: { fontSize: 18, fontWeight: '900', color: palette.text, letterSpacing: -0.4, marginTop: 12, textAlign: 'center' },
  body: { fontSize: 14, fontWeight: '600', color: palette.textMeta, lineHeight: 21, marginTop: 6, textAlign: 'center' },
  primary: {
    alignSelf: 'stretch',
    height: 50,
    borderRadius: 14,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  ghost: { alignSelf: 'stretch', height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  ghostText: { color: palette.textMeta, fontSize: 14.5, fontWeight: '700' },
});
