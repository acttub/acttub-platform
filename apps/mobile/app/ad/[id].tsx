import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { SkeletonDetail } from '@/components/ui/skeleton';
import { palette } from '@/constants/palette';
import { AD_RADIUS, AD_SIZES, type AdDetail } from '@/lib/ads';
import { api } from '@/lib/api';

/**
 * 학원 직접 광고 상세(SOMA-876). 광고 칸의 학원 배너를 누르면 온다. 광고주가 낸 학원 정보(학원 등록번호·교습과정·
 * 교습비)를 고쳐 쓰지 않고 그대로 보이고, 더 알아보기는 학원의 외부 링크로 연다.
 */
export default function AdDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [ad, setAd] = useState<AdDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getAd(id)
      .then(setAd)
      .catch(() => setError('광고 정보를 불러오지 못했어요.'));
  }, [id]);

  const rows: [string, string | null][] = ad
    ? [
        ['학원명', ad.advertiser_name],
        ['학원 등록번호', ad.academy_registration_no],
        ['교습과정', ad.course_name],
        ['교습비', ad.tuition],
      ]
    : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <NavHeader
        title={ad?.advertiser_name ?? '광고'}
        left={<NavIconButton icon="chevron-left" label="뒤로" phLabel="ad_detail_back" onPress={() => router.back()} />}
      />
      {!ad && !error && <SkeletonDetail lines={5} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {ad && (
        <>
          <ScrollView contentContainerStyle={styles.content}>
            {ad.image_url ? (
              <Image
                source={{ uri: ad.image_url }}
                style={[styles.image, { aspectRatio: AD_SIZES.MEDIUM_RECTANGLE.width / AD_SIZES.MEDIUM_RECTANGLE.height }]}
                contentFit="cover"
              />
            ) : null}
            {ad.headline ? <Text style={styles.headline}>{ad.headline}</Text> : null}
            {ad.body ? <Text style={styles.body}>{ad.body}</Text> : null}
            <View style={styles.card}>
              {rows.map(([label, value]) => (
                <View key={label} style={styles.row}>
                  <Text style={styles.label}>{label}</Text>
                  <Text style={styles.value}>{value ?? '-'}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.note}>이 정보는 광고주가 제공한 내용이에요. 교습비는 추가 경비를 포함한 금액이에요.</Text>
          </ScrollView>
          {ad.link_url ? (
            <View style={styles.bottom}>
              <Pressable
                style={styles.cta}
                accessibilityRole="link"
                ph-label="ad_detail_open_link"
                onPress={() => void Linking.openURL(ad.link_url!)}
              >
                <Text style={styles.ctaText}>학원 페이지 열기</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  content: { padding: 16, gap: 16 },
  image: { width: '100%', borderRadius: AD_RADIUS, backgroundColor: palette.bgSoft },
  headline: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 20, lineHeight: 28 },
  body: { color: palette.textDim, fontFamily: 'Pretendard', fontSize: 15, lineHeight: 22 },
  card: { borderRadius: AD_RADIUS, backgroundColor: palette.bgSubtle, paddingHorizontal: 16, paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.borderSoft,
  },
  label: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 14 },
  value: { flexShrink: 1, color: palette.text, fontFamily: 'Pretendard-SemiBold', fontSize: 14, textAlign: 'right' },
  note: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 12, lineHeight: 18 },
  error: { margin: 24, color: palette.textDim, fontFamily: 'Pretendard', fontSize: 14 },
  bottom: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  cta: { height: 52, borderRadius: 14, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#FFFFFF', fontFamily: 'Pretendard-SemiBold', fontSize: 16 },
});
