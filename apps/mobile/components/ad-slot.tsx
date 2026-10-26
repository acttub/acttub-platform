import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/palette';
import {
  AD_LABEL,
  AD_RADIUS,
  AD_SIZES,
  AD_SLOTS,
  bannerUnitFor,
  renderableKind,
  shouldRequestSlot,
  type AdSlotKey,
  type AdSlotPick,
} from '@/lib/ads';
import { loadBannerModule } from '@/lib/ads-native';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { getFirstTimeState, subscribeFirstTimeState } from '@/lib/practice/first-time';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

/** 칸마다 마지막으로 받은 결과. 같은 화면에 다시 오면 이것으로 바로 그리고 뒤에서 새로 받는다(칸이 깜빡이지 않게). */
const lastPick = new Map<AdSlotKey, AdSlotPick>();

type Props = {
  slot: AdSlotKey;
  /** 바깥 여백 등. 칸이 비면(NONE) 이 스타일도 함께 사라진다. */
  style?: StyleProp<ViewStyle>;
};

/**
 * 광고 칸 하나(SOMA-876). 서버(GET /v2/ads)가 고른 대로 학원·우리 앱 이미지 배너, AdMob 배너, 또는 아무것도 그리지 않는다.
 *
 * - 받기 전에는 칸 규격 비율의 빈 자리를 먼저 잡는다(스켈레톤 없이) — 받은 뒤 화면이 밀리지 않게.
 * - 첫 연습 전 사용자(lib/practice/first-time 'first')는 서버에 묻지 않고 처음부터 비운다.
 * - 이미지형은 칸 폭에 맞춰 비율을 지키고 모서리 16, 오른쪽 위에 「광고」 라벨. AdMob 배너는 같은 자리 가운데에 두고,
 *   광고 위에 우리 요소를 덮지 않는다(AdMob 정책 — 배너는 자체 광고 표시를 갖는다).
 */
export function AdSlot({ slot, style }: Props) {
  const router = useRouter();
  const firstTime = useSyncExternalStore(subscribeFirstTimeState, getFirstTimeState, getFirstTimeState);
  const [pick, setPick] = useState<AdSlotPick | null>(() => lastPick.get(slot) ?? null);
  const [loaded, setLoaded] = useState(() => lastPick.has(slot));
  const [failed, setFailed] = useState(false);
  const impressed = useRef<string | null>(null);
  const request = shouldRequestSlot(firstTime);

  useEffect(() => {
    if (!request) return;
    let alive = true;
    api
      .getAdSlot(slot)
      .then((next) => {
        if (!alive) return;
        lastPick.set(slot, next);
        setPick(next);
        setFailed(false);
      })
      .catch(() => {
        // 게스트(403)·네트워크 오류 — 칸을 비운다
        if (alive && !lastPick.has(slot)) setPick(null);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [slot, request]);

  if (!request) return null;

  const size = pick?.size ?? AD_SLOTS[slot].size;
  const spec = AD_SIZES[size];
  const box = [styles.box, { aspectRatio: spec.width / spec.height }];

  if (!loaded) {
    return <View style={[box, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
  }

  const kind = failed ? 'NONE' : renderableKind(pick);
  if (kind === 'NONE' || !pick) return null;

  if (kind === 'NETWORK') {
    const banner = loadBannerModule();
    if (!banner) return null;
    const { BannerAd, BannerAdSize } = banner;
    return (
      <View style={[box, styles.network, style]} ph-no-capture>
        <BannerAd
          unitId={bannerUnitFor(slot, Platform.OS === 'ios' ? 'ios' : 'android', API_URL)}
          size={BannerAdSize[size]}
          onAdLoaded={() => void logEvent('ad_network_loaded', { slot })}
          onAdFailedToLoad={() => setFailed(true)}
        />
      </View>
    );
  }

  const ad = pick.ad!;
  const onImpression = () => {
    if (impressed.current === ad.id) return;
    impressed.current = ad.id;
    api.recordAdEvent(ad.id, slot, 'impression').catch(() => undefined);
  };
  const onPress = () => {
    api.recordAdEvent(ad.id, slot, 'click').catch(() => undefined);
    if (kind === 'DIRECT') {
      router.push({ pathname: '/ad/[id]', params: { id: ad.id } });
    } else if (ad.app_path) {
      router.push(ad.app_path as Href);
    }
  };

  return (
    <Pressable
      style={[box, styles.creative, style]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`광고 ${ad.advertiser_name ?? ad.headline ?? ''}`.trim()}
      ph-label={`ad_${slot}`}
    >
      {ad.image_url ? (
        <Image
          source={{ uri: ad.image_url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          onLoad={onImpression}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.textAd} onLayout={onImpression}>
          <Text style={styles.headline} numberOfLines={size === 'BANNER' ? 1 : 2}>
            {ad.headline}
          </Text>
          {ad.body && size !== 'BANNER' ? (
            <Text style={styles.body} numberOfLines={size === 'MEDIUM_RECTANGLE' ? 4 : 1}>
              {ad.body}
            </Text>
          ) : null}
        </View>
      )}
      <View style={styles.label} pointerEvents="none">
        <Text style={styles.labelText}>{AD_LABEL.text}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: '100%',
  },
  network: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  creative: {
    borderRadius: AD_RADIUS,
    overflow: 'hidden',
    backgroundColor: palette.bgSoft,
  },
  textAd: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 4,
  },
  headline: {
    fontSize: 15,
    fontFamily: 'Pretendard-SemiBold',
    color: palette.text,
  },
  body: {
    fontSize: 13,
    fontFamily: 'Pretendard',
    color: palette.textDim,
  },
  label: {
    position: 'absolute',
    top: AD_LABEL.inset,
    right: AD_LABEL.inset,
    backgroundColor: AD_LABEL.background,
    borderRadius: AD_LABEL.radius,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  labelText: {
    color: '#FFFFFF',
    fontSize: AD_LABEL.fontSize,
    fontFamily: 'Pretendard-SemiBold',
  },
});
