import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { InlineError, InlineErrorLine } from '@/components/ui/inline-error';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useStorePurchase } from '@/hooks/use-store-purchase';
import { api } from '@/lib/api';
import {
  paywallState,
  PRIVACY_URL,
  proFrom,
  purchaseOpen,
  TERMS_URL,
  type BillingMe,
  type ProFrom,
} from '@/lib/billing';
import { translate as t } from '@/lib/i18n';
import type { StorePlan } from '@/lib/store-billing';

type Context = {
  mascot: ImageSourcePropType;
  title: string;
  benefits: readonly [string, string, string];
  /** 한도에 걸려 들어왔으면 맨 위 상자(마스코트 48 · 제목 · 설명)가 마스코트 96 자리를 대신한다. */
  hero: { mascot: ImageSourcePropType; title: string; body: string } | null;
};

/** 들어온 곳마다 다른 위쪽 안내. 값은 번역 키다. */
const CONTEXT: Record<ProFrom, Context> = {
  default: {
    mascot: MASCOT.cheer,
    title: 'pro.titleDefault',
    benefits: ['pro.benefitUnlimited', 'pro.benefitModel', 'pro.benefitExtras'],
    hero: null,
  },
  coaching: {
    mascot: MASCOT.cheer,
    title: 'pro.titleCoaching',
    benefits: ['pro.benefitCoaching', 'pro.benefitModel', 'pro.benefitHabit'],
    hero: { mascot: MASCOT.coach, title: 'pro.coachingLimitTitle', body: 'pro.heroCoachingBody' },
  },
  script: {
    mascot: MASCOT.cheer,
    title: 'pro.titleScript',
    benefits: ['pro.benefitScripts', 'pro.benefitVoice', 'pro.benefitPron'],
    hero: { mascot: MASCOT.reading, title: 'pro.scriptLimitTitle', body: 'pro.heroScriptBody' },
  },
  pron: {
    mascot: MASCOT.cheer,
    title: 'pro.titlePron',
    benefits: ['pro.benefitPron', 'pro.benefitVoice', 'pro.benefitUnlimited'],
    hero: null,
  },
};

/**
 * ⑥ Pro · 안내(SOMA-818). 설정 「ACTTUB Pro」 줄과 무료 한도 팝업·발음 보고서의 Pro 안내가 연다(`from` 으로 들어온 곳을 받는다).
 * 서버가 앱 결제를 열어 두었고 아직 Pro 가 아닐 때만 요금제·[Pro 시작하기]·구매 복원을 그린다(스토어 구독). 요금제 카드에 스토어가 준
 * 현지화 가격·갱신 주기를, 그 아래 해지 방법·약관 링크를 둔다. 앱 안에서 웹 결제로 보내는 버튼·링크는 없다.
 */
export default function ProScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const context = CONTEXT[proFrom(params.from)];
  const [me, setMe] = useState<BillingMe | null>(null);
  const reload = useCallback(() => {
    void api.billingMe().then(setMe).catch(() => undefined);
  }, []);
  useEffect(reload, [reload]);
  const [plan, setPlan] = useState<StorePlan>('monthly');
  const purchase = useStorePurchase({
    enabled: purchaseOpen(me),
    onConfirmed: (confirmed) => {
      setMe(confirmed);
      router.replace('/pro-done');
    },
  });
  const state = paywallState(me, purchase);
  const selling = state.kind !== 'already_pro' && state.kind !== 'closed';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader left={<NavBackButton phLabel="pro_back" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={styles.body}>
        {context.hero ? (
          <View style={styles.hero}>
            <Image source={context.hero.mascot} style={MASCOT_SIZE.card} contentFit="contain" cachePolicy="memory-disk" />
            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>{t(context.hero.title)}</Text>
              <Text style={styles.heroBody}>{t(context.hero.body)}</Text>
            </View>
          </View>
        ) : (
          <Image source={state.kind === 'already_pro' ? MASCOT.jump : context.mascot} style={styles.mascot} contentFit="contain"
            cachePolicy="memory-disk" />
        )}
        <Text style={styles.title} accessibilityRole="header">{t(context.title)}</Text>
        <View style={styles.benefits}>
          {context.benefits.map((key) => (
            <View key={key} style={styles.benefit}>
              <Feather name="check" size={20} color={palette.blue} />
              <Text style={styles.benefitText}>{t(key)}</Text>
            </View>
          ))}
        </View>
        <View style={styles.flex} />
        {state.kind === 'already_pro' && (
          <View style={styles.alreadyPro}>
            <Text style={styles.alreadyProText}>{t('pro.alreadyPro')}</Text>
          </View>
        )}
        {state.kind === 'prices_failed' && <InlineError message={t('pro.pricesFailed')} />}
        {selling && state.kind !== 'prices_failed' && (
          <PlanPicker plan={plan} prices={purchase.prices} onPick={setPlan} disabled={state.kind === 'busy'} />
        )}
        {selling && (
          <View style={styles.legal}>
            <Text style={styles.legalText}>{Platform.OS === 'ios' ? t('pro.cancelIos') : t('pro.cancelAndroid')}</Text>
            <View style={styles.links}>
              <LegalLink label={t('pro.restore')} onPress={purchase.restore} disabled={state.kind === 'busy'} />
              <Text style={styles.dot}>·</Text>
              <LegalLink label={t('pro.terms')} onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)} />
              <Text style={styles.dot}>·</Text>
              <LegalLink label={t('pro.privacy')} onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)} />
            </View>
          </View>
        )}
      </ScrollView>
      {selling && (
        <CtaBar>
          {state.kind === 'failed' && <InlineErrorLine message={state.message} />}
          <PrimaryButton
            label={t('pro.start')}
            loading={state.kind === 'busy'}
            loadingLabel={state.kind === 'busy' ? state.label : undefined}
            onPress={() => purchase.begin(plan)}
            disabled={(state.kind !== 'ready' && state.kind !== 'failed' && state.kind !== 'busy') || !purchase.prices[plan]}
            phLabel={plan === 'yearly' ? 'pro_start_yearly' : 'pro_start'}
          />
        </CtaBar>
      )}
    </SafeAreaView>
  );
}

function LegalLink({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    // 글자 줄이 19라 위아래 13씩 넓혀 누르는 자리를 44 넘게 둔다.
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="link" hitSlop={{ top: 13, bottom: 13, left: 6, right: 6 }}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

const PLANS: { key: StorePlan; title: string; desc: string; descPriced: string; unit: string }[] = [
  { key: 'monthly', title: 'pro.planMonthly', desc: 'pro.planMonthlyDesc', descPriced: 'pro.planMonthlyDesc', unit: 'pro.unitMonth' },
  { key: 'yearly', title: 'pro.planYearly', desc: 'pro.planYearlyDesc', descPriced: 'pro.planYearlyPerMonth', unit: 'pro.unitYear' },
];

/**
 * 월·연 요금제 고르기(기본 월). 가격은 스토어가 준 현지화 값이고, 받는 동안은 가격 자리에 뼈대를 둔다. 가격을 받았는데 오퍼링에 없는
 * 요금제는 흐리게 두고 고를 수 없다.
 */
function PlanPicker({ plan, prices, onPick, disabled }: {
  plan: StorePlan;
  prices: Record<StorePlan, string | null>;
  onPick: (plan: StorePlan) => void;
  disabled: boolean;
}) {
  const priced = prices.monthly !== null || prices.yearly !== null;
  return (
    <View style={styles.plans} accessibilityRole="radiogroup">
      {PLANS.map((o) => {
        const selected = plan === o.key;
        const price = prices[o.key];
        const off = disabled || !price;
        return (
          <Pressable key={o.key} onPress={() => onPick(o.key)} disabled={off} accessibilityRole="radio"
            accessibilityState={{ selected, disabled: off }}
            style={[styles.plan, selected && styles.planOn, priced && !price && styles.planDim]}>
            <Checkbox checked={selected} />
            <View style={styles.planBody}>
              <View style={styles.planHead}>
                <Text style={[styles.planTitle, selected && styles.planTitleOn]}>{t(o.title)}</Text>
                {o.key === 'yearly' && (
                  <Text style={[styles.planTag, selected && styles.planTagOn]}>{t('pro.planYearlyBadge')}</Text>
                )}
              </View>
              <Text style={styles.planDesc}>{t(price ? o.descPriced : o.desc)}</Text>
            </View>
            {price ? (
              <View style={styles.planPrice}>
                <Text style={[styles.planTitle, selected && styles.planTitleOn]}>{price}</Text>
                <Text style={styles.planUnit}>{t(o.unit)}</Text>
              </View>
            ) : (
              !priced && <SkeletonBlock width={72} height={14} radius={radius.xs} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { flexGrow: 1, paddingHorizontal: space.gutter, paddingTop: space[3], paddingBottom: space[4], gap: space[4] },
  flex: { flex: 1, minHeight: space[6] },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bgSubtle,
  },
  heroText: { flex: 1, gap: space[1] },
  heroTitle: { ...type.body1Bold, color: palette.text },
  heroBody: { ...type.body2, color: palette.textSub },
  mascot: { ...MASCOT_SIZE.empty, alignSelf: 'center', marginTop: space[6] },
  title: { ...type.title1, color: palette.text, textAlign: 'center' },
  benefits: { alignSelf: 'center', gap: space[3] },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  benefitText: { ...type.body1, color: palette.text },
  alreadyPro: {
    alignItems: 'center',
    padding: space[5],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bgSubtle,
  },
  alreadyProText: { ...type.body1Bold, color: palette.text },
  plans: { gap: space[3] },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[4],
    paddingHorizontal: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  // 테두리가 0.5 굵어진 만큼 안쪽을 줄여 고를 때 글자가 움직이지 않게 한다.
  planOn: {
    borderWidth: 1.5,
    borderColor: palette.blue,
    backgroundColor: palette.blueSoft,
    paddingVertical: space[4] - 0.5,
    paddingHorizontal: space[4] - 0.5,
  },
  planDim: { opacity: 0.5 },
  planBody: { flex: 1, gap: space[1] },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  planTitle: { ...type.body1Bold, color: palette.text },
  planTitleOn: { color: palette.blueDeep },
  planTag: {
    ...type.micro,
    color: palette.blueDeep,
    backgroundColor: palette.blueSoft,
    borderRadius: radius.full,
    paddingHorizontal: space[2],
    paddingVertical: 2,
    overflow: 'hidden',
  },
  planTagOn: { backgroundColor: palette.bg },
  planDesc: { ...type.body2, color: palette.textSub },
  planPrice: { alignItems: 'flex-end', gap: space[1] },
  planUnit: { ...type.caption, color: palette.textMeta },
  legal: { alignItems: 'center', gap: space[1] },
  legalText: { ...type.caption, color: palette.textMeta, textAlign: 'center' },
  links: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  link: { ...type.captionBold, color: palette.textMeta },
  dot: { ...type.caption, color: palette.textDisabled },
});
