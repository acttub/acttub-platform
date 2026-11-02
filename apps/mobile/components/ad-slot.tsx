import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/palette';
import {
  AD_LABEL,
  AD_RADIUS,
  AD_SIZES,
  AD_SLOTS,
  adRequestConfigFor,
  bannerUnitFor,
  isHttpLink,
  renderableKind,
  shouldRequestSlot,
  type AdSlotKey,
  type AdSlotPick,
} from '@/lib/ads';
import { loadBannerModule } from '@/lib/ads-native';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { kstDate } from '@/lib/auditions';
import { useAuth } from '@/lib/auth';
import { getFirstTimeState, subscribeFirstTimeState } from '@/lib/practice/first-time';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

/** 칸마다 마지막으로 받은 결과. 같은 화면에 다시 오면 이것으로 바로 그리고 뒤에서 새로 받는다(칸이 깜빡이지 않게). */
const lastPick = new Map<AdSlotKey, AdSlotPick>();

type Props = {
  slot: AdSlotKey;
  /** 바깥 여백 등. 칸이 비면(NONE) 이 스타일도 함께 사라진다. */
  style?: StyleProp<ViewStyle>;
  /** AdMob 배너를 기다리는 시간(ms). 테스트에서만 줄인다. */
  fillTimeoutMs?: number;
  /**
   * 화면 아래 탭바 위에 붙이는 고정 배너(게시판). 좌우 끝까지 채운다 — AdMob 은 폭에 맞춘 적응형 배너(ANCHORED_ADAPTIVE_BANNER),
   * 학원·우리 앱 이미지는 모서리 없이 규격 비율로 꽉 채운다. 받기 전 자리는 높이 50.
   */
  anchored?: boolean;
};

/**
 * 광고 칸 하나(SOMA-876). 서버(GET /v2/ads)가 고른 대로 학원·우리 앱 이미지 배너, AdMob 배너, 또는 아무것도 그리지 않는다.
 *
 * - 받기 전에는 칸 규격 비율의 빈 자리를 먼저 잡는다(스켈레톤 없이) — 받은 뒤 화면이 밀리지 않게.
 * - 첫 연습 전 사용자(lib/practice/first-time 'first')는 서버에 묻지 않고 처음부터 비운다.
 * - 이미지형은 칸 폭에 맞춰 비율을 지키고 모서리 16, 오른쪽 위에 「광고」 라벨. AdMob 배너는 같은 자리 가운데에 두고,
 *   광고 위에 우리 요소를 덮지 않는다(AdMob 정책 — 배너는 자체 광고 표시를 갖는다).
 */
/** AdMob 배너가 이 시간 안에 안 채워지면 칸을 접는다. */
export const NETWORK_FILL_TIMEOUT_MS = 6000;

export function AdSlot({ slot, style, fillTimeoutMs = NETWORK_FILL_TIMEOUT_MS, anchored = false }: Props) {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { profile } = useAuth();
  const firstTime = useSyncExternalStore(subscribeFirstTimeState, getFirstTimeState, getFirstTimeState);
  const [pick, setPick] = useState<AdSlotPick | null>(() => lastPick.get(slot) ?? null);
  const [loaded, setLoaded] = useState(() => lastPick.has(slot));
  const [failed, setFailed] = useState(false);
  const impressed = useRef<string | null>(null);
  const request = shouldRequestSlot(firstTime);
  // AdMob 배너가 채워지지 않으면 실패 신호 없이 빈 상자만 남아 화면 위에 빈 공간이 생겼다(11/2 폰 QA).
  // 정해진 시간 안에 안 채워지면 칸을 접는다. 채워진 배너는 그대로 둔다.
  const [networkFilled, setNetworkFilled] = useState(false);
  const waitingNetwork = request && loaded && !failed && !networkFilled && renderableKind(pick) === 'NETWORK';
  useEffect(() => {
    if (!waitingNetwork) return undefined;
    const timer = setTimeout(() => setFailed(true), fillTimeoutMs);
    return () => clearTimeout(timer);
  }, [waitingNetwork, fillTimeoutMs]);

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
  // 배너(320×50·320×100)는 화면 좌우 끝까지 붙인다(11/2 사용자 「배너 광고 다 양옆에 붙여」). 300×250 은 그대로 가운데.
  const bleed = anchored || AD_SLOTS[slot].size !== 'MEDIUM_RECTANGLE';
  const box = [styles.box, { aspectRatio: spec.width / spec.height }];

  if (!loaded) {
    if (bleed) {
      return (
        <FullBleed>
          <View style={[styles.box, { height: spec.height }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        </FullBleed>
      );
    }
    return <View style={[box, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
  }

  const kind = failed ? 'NONE' : renderableKind(pick);
  if (kind === 'NONE' || !pick) return null;

  if (kind === 'NETWORK') {
    const banner = loadBannerModule();
    if (!banner) return null;
    const { BannerAd, BannerAdSize } = banner;
    // 좌우를 채우는 칸은 AdMob 인라인 적응형 배너를 쓴다 — 고정 규격(320)은 넓은 폰에서 양옆이 빈다.
    // 탭바 위 고정 칸도 인라인이다: ANCHORED 는 폭에 안 맞는 광고(468×60 등)를 줄이고 위아래·양옆을 검게 채웠다(11/3 폰 QA).
    // 높이 한도는 규격 비율을 화면 폭으로 키운 값이다 — 규격 높이(50)로 막으면 광고가 납작하게 눌렸다(홈, 11/3 폰 QA).
    const bannerSize = bleed ? BannerAdSize.INLINE_ADAPTIVE_BANNER : BannerAdSize[size];
    const bleedMaxHeight = Math.max(spec.height, Math.ceil((windowWidth * spec.height) / spec.width));
    return (
      <FullBleed on={bleed}>
        <View style={[bleed ? [styles.box, anchored && { minHeight: spec.height }] : box, styles.network, style]} ph-no-capture>
          <BannerAd
            unitId={bannerUnitFor(slot, Platform.OS === 'ios' ? 'ios' : 'android', API_URL)}
            size={bannerSize}
            maxHeight={bleed ? bleedMaxHeight : undefined}
          requestOptions={{
            requestNonPersonalizedAdsOnly: adRequestConfigFor(profile.me?.profile?.birth_date, kstDate())
              .requestNonPersonalizedAdsOnly,
          }}
          onAdLoaded={() => {
            setNetworkFilled(true);
            void logEvent('ad_network_loaded', { slot });
          }}
            onAdFailedToLoad={() => setFailed(true)}
          />
        </View>
      </FullBleed>
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
      // 상세는 광고주 쪽 페이지다 — 앱 밖 브라우저로 바로 연다
      if (isHttpLink(ad.link_url)) Linking.openURL(ad.link_url).catch(() => undefined);
    } else if (ad.app_path) {
      router.push(ad.app_path as Href);
    }
  };

  return (
    <FullBleed on={bleed}>
    <Pressable
      style={[box, styles.creative, bleed && styles.flush, style]}
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
    </FullBleed>
  );
}

/**
 * 안의 칸을 화면 좌우 끝까지 넓힌다. 바깥 칸은 부모 폭 그대로 두고 화면에서의 왼쪽 위치를 재서, 안쪽을 그만큼 왼쪽으로 당기고
 * 화면 폭으로 늘린다(부모 좌우 여백이 화면마다 달라도 같은 결과). 바깥 칸은 움직이지 않아 다시 재도 값이 같다.
 */
function FullBleed({ on = true, children }: { on?: boolean; children: ReactNode }) {
  const ref = useRef<View>(null);
  const { width } = useWindowDimensions();
  const [left, setLeft] = useState<number | null>(null);
  if (!on) return <>{children}</>;
  return (
    <View ref={ref} onLayout={() => ref.current?.measureInWindow((x) => setLeft(Math.round(x)))}>
      <View style={left === null ? undefined : { marginLeft: -left, width }}>{children}</View>
    </View>
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
  flush: { borderRadius: 0 },
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
    color: palette.textSub,
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
