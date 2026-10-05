import type { CloudVoiceConsent } from './reading/cloud-voice.ts';

/**
 * 앱 첫 화면 공지 포스터(app.poster). 서버(GET /v2/app/posters)가 지금 띄울 수 있는 것을 우선순위대로 주고,
 * 빈도·다시 보지 않기·대상(audience)은 기기 상태로 여기서 판정한다.
 */

export type PosterFrequency = 'daily' | 'once';
export type PosterAudience = 'all' | 'cloud_voice_off';
export type PosterCtaAction = 'none' | 'cloud_voice_enable' | 'route' | 'url';

/** API 응답의 포스터 한 장 그대로. */
export type Poster = {
  slug: string;
  revision: number;
  frequency: PosterFrequency;
  audience: PosterAudience;
  dismissible: boolean;
  badge: string | null;
  title: string;
  body: string | null;
  image_url: string | null;
  image_asset: string | null;
  audio_asset: string | null;
  cta_label: string | null;
  cta_action: PosterCtaAction;
  cta_target: string | null;
};

export type PostersResponse = { posters: Poster[] };

/** slug 하나의 기기 기록. revision 이 포스터와 다르면 없던 것으로 본다. */
export type PosterRecord = { revision: number; lastShownDay: string | null; shownOnce: boolean; dismissedForever: boolean };
export type PosterState = Record<string, PosterRecord>;

export type PosterContext = {
  /** 한국 날짜(YYYY-MM-DD). */
  today: string;
  /** 고품질 목소리 상태. 모르면 null — 그때 cloud_voice_off 포스터는 띄우지 않는다. */
  cloudVoice: { available: boolean; enabled: boolean; consent: CloudVoiceConsent } | null;
};

export const POSTERS_KEY = 'acttub.posters';
/** 0.1.2 의 고정 홍보 팝업이 쓰던 키. 처음 읽을 때 새 상태로 옮기고 지운다. */
export const LEGACY_PROMO_KEY = 'acttub.cloudVoicePromo';
/** 옛 홍보를 옮긴 서버 포스터의 slug(V29 seed). */
export const LEGACY_PROMO_SLUG = 'cloud-voice-launch';

/** 앱에 들어 있는 자산. 서버가 이 밖의 이름을 주면 그 칸을 숨긴다. */
export const IMAGE_ASSETS = ['mascot-reading'] as const;
export const AUDIO_ASSETS = ['cloud-voice-sample'] as const;
export type PosterImageAsset = (typeof IMAGE_ASSETS)[number];
export type PosterAudioAsset = (typeof AUDIO_ASSETS)[number];

export type PosterCta =
  | { kind: 'cloud_voice_enable'; label: string }
  | { kind: 'route'; label: string; target: string }
  | { kind: 'url'; label: string; target: string };

export function koreaDay(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

function emptyRecord(revision: number): PosterRecord {
  return { revision, lastShownDay: null, shownOnce: false, dismissedForever: false };
}

function isRecord(value: unknown): value is PosterRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.revision === 'number'
    && (record.lastShownDay === null || typeof record.lastShownDay === 'string')
    && typeof record.shownOnce === 'boolean'
    && typeof record.dismissedForever === 'boolean';
}

export function parsePosterState(raw: string | null): PosterState {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const state: PosterState = {};
    for (const [slug, record] of Object.entries(value as Record<string, unknown>)) {
      if (isRecord(record)) state[slug] = record;
    }
    return state;
  } catch { return {}; }
}

/** 그 포스터의 지금 판 기록. 저장된 revision 이 다르면 새로 시작한다. */
export function recordFor(state: PosterState, poster: Pick<Poster, 'slug' | 'revision'>): PosterRecord {
  const stored = state[poster.slug];
  return stored && stored.revision === poster.revision ? stored : emptyRecord(poster.revision);
}

function wantsCloudVoice(ctx: PosterContext): boolean {
  const cloud = ctx.cloudVoice;
  return !!cloud && cloud.available && !(cloud.enabled && cloud.consent === 'granted');
}

export function isEligible(poster: Poster, state: PosterState, ctx: PosterContext): boolean {
  const record = recordFor(state, poster);
  if (record.dismissedForever) return false;
  if (poster.frequency === 'once' && record.shownOnce) return false;
  if (poster.frequency === 'daily' && record.lastShownDay === ctx.today) return false;
  if (poster.audience === 'cloud_voice_off' && !wantsCloudVoice(ctx)) return false;
  return true;
}

/** 서버 순서(우선순위)대로 처음 보일 수 있는 것. 없으면 null. */
export function pickPoster(posters: Poster[], state: PosterState, ctx: PosterContext): Poster | null {
  return posters.find((poster) => isEligible(poster, state, ctx)) ?? null;
}

export function markShown(state: PosterState, poster: Pick<Poster, 'slug' | 'revision'>, today: string): PosterState {
  return { ...state, [poster.slug]: { ...recordFor(state, poster), lastShownDay: today, shownOnce: true } };
}

export function markDismissed(state: PosterState, poster: Pick<Poster, 'slug' | 'revision'>): PosterState {
  return { ...state, [poster.slug]: { ...recordFor(state, poster), dismissedForever: true } };
}

/** 옛 홍보 기록을 cloud-voice-launch(revision 1)로 옮긴다. 이미 새 기록이 있으면 그것을 둔다. */
export function migrateLegacyPromo(state: PosterState, legacyRaw: string | null): PosterState {
  if (!legacyRaw || state[LEGACY_PROMO_SLUG]) return state;
  let legacy: { dismissedForever?: unknown; lastShownDay?: unknown };
  try { legacy = JSON.parse(legacyRaw) as typeof legacy; } catch { return state; }
  if (!legacy || typeof legacy !== 'object') return state;
  return {
    ...state,
    [LEGACY_PROMO_SLUG]: {
      revision: 1,
      lastShownDay: typeof legacy.lastShownDay === 'string' ? legacy.lastShownDay : null,
      shownOnce: false,
      dismissedForever: legacy.dismissedForever === true,
    },
  };
}

export type PosterStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** 기기 상태를 읽는다. 옛 홍보 키가 남아 있으면 옮겨 저장하고 지운다. */
export async function loadPosterState(storage: PosterStorage): Promise<PosterState> {
  const [raw, legacyRaw] = await Promise.all([storage.getItem(POSTERS_KEY), storage.getItem(LEGACY_PROMO_KEY)]);
  const state = parsePosterState(raw);
  if (legacyRaw === null) return state;
  const migrated = migrateLegacyPromo(state, legacyRaw);
  await storage.setItem(POSTERS_KEY, JSON.stringify(migrated));
  await storage.removeItem(LEGACY_PROMO_KEY);
  return migrated;
}

export async function savePosterState(storage: PosterStorage, state: PosterState): Promise<void> {
  await storage.setItem(POSTERS_KEY, JSON.stringify(state));
}

export function imageAssetOf(poster: Poster): PosterImageAsset | null {
  return (IMAGE_ASSETS as readonly string[]).includes(poster.image_asset ?? '') ? (poster.image_asset as PosterImageAsset) : null;
}

export function audioAssetOf(poster: Poster): PosterAudioAsset | null {
  return (AUDIO_ASSETS as readonly string[]).includes(poster.audio_asset ?? '') ? (poster.audio_asset as PosterAudioAsset) : null;
}

/** 누를 수 있는 버튼. 문구가 없거나 대상이 안전하지 않으면 null — 버튼을 숨긴다. */
export function ctaOf(poster: Poster): PosterCta | null {
  const label = poster.cta_label;
  if (!label) return null;
  const target = poster.cta_target ?? '';
  switch (poster.cta_action) {
    case 'cloud_voice_enable': return { kind: 'cloud_voice_enable', label };
    case 'route': return target.startsWith('/') ? { kind: 'route', label, target } : null;
    case 'url': return target.startsWith('https://') ? { kind: 'url', label, target } : null;
    default: return null;
  }
}
