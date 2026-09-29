import type { CloudVoiceConsent } from './reading/cloud-voice.ts';

export const CLOUD_VOICE_PROMO_KEY = 'acttub.cloudVoicePromo';
export type CloudVoicePromoState = { dismissedForever: boolean; lastShownDay: string | null };
export const EMPTY_CLOUD_VOICE_PROMO: CloudVoicePromoState = { dismissedForever: false, lastShownDay: null };

export function koreaDay(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

export function parseCloudVoicePromoState(raw: string | null): CloudVoicePromoState {
  if (!raw) return EMPTY_CLOUD_VOICE_PROMO;
  try {
    const value = JSON.parse(raw) as Partial<CloudVoicePromoState>;
    return { dismissedForever: value.dismissedForever === true, lastShownDay: typeof value.lastShownDay === 'string' ? value.lastShownDay : null };
  } catch { return EMPTY_CLOUD_VOICE_PROMO; }
}

export function shouldShowCloudVoicePromo(input: {
  loggedIn: boolean; available: boolean; consent: CloudVoiceConsent; enabled: boolean;
  freeUntil: string | null; promo: CloudVoicePromoState; today: string; now: number;
  otherModalOpen: boolean; onboardingJustFinished: boolean;
}): boolean {
  if (!input.loggedIn || !input.available || input.promo.dismissedForever || input.promo.lastShownDay === input.today) return false;
  if (input.otherModalOpen || input.onboardingJustFinished || (input.enabled && input.consent === 'granted')) return false;
  const end = input.freeUntil ? Date.parse(input.freeUntil) : NaN;
  return Number.isFinite(end) && input.now <= end;
}
