import type { LineMatch } from './match.ts';

/**
 * 대본 리딩 발성·발음 피드백(실험). 내 차례 한 줄의 소리를 기기 안에서만 보고 짧은 칩으로 알린다 — 서버·외부
 * 호출 없음. 소리 크기는 녹음 장치마다 크게 달라(운영 녹음 -50dBFS 안팎) 절대값이 아니라 주변 소리와의 차이로 본다.
 * 발음은 받아쓰기와 대본의 대조(match)로 "알아듣기 어려운 곳" 정도만 짚는다.
 *
 * 기준값은 TTS·운영 녹음으로 잡은 초안이다(~/.acttub-work/voice-feedback). 쌓이면 다시 잡는다.
 */
export const VOICE_FEEDBACK_THRESHOLDS = {
  /** 목소리(상위 5%)와 주변 소리(하위 10%)의 차이가 이보다 작으면 quiet. */
  minSnrDb: 15,
  /** 끝 20%가 가운데 60%보다 이만큼 작으면 end_drop. 2초 미만 대사는 보지 않는다. */
  endDropDb: 5,
  endDropMinMs: 2_000,
  fastSps: 6.5,
  slowSps: 2.5,
  /** 음높이 폭(10~90% 반음)이 이보다 좁으면 flat. */
  flatSt: 4,
  pauseMs: 700,
  /** 대조 점수가 이보다 낮으면 unclear. */
  unclearCloseness: 0.7,
  /** 말한 구간이 이보다 짧으면 판단하지 않는다(null). */
  minSpeechMs: 400,
};

export type FeedbackChip = 'unclear' | 'quiet' | 'end_drop' | 'fast' | 'slow' | 'flat' | 'pauses';
/** 보여 줄 때의 순서 — 앞이 더 중요하다. */
const CHIP_ORDER: FeedbackChip[] = ['unclear', 'quiet', 'end_drop', 'fast', 'slow', 'flat', 'pauses'];
const MAX_CHIPS = 3;

export type VoiceMetrics = {
  speechMs: number;
  snrDb: number;
  endDropDb: number | null;
  sps: number | null;
  pitchRangeSt: number | null;
  longPauses: number[];
  closeness: number | null;
};

export type VoiceFeedback = { metrics: VoiceMetrics; chips: FeedbackChip[] };

export type VoiceFeedbackInput = {
  /** 고른 간격의 소리 크기(dBFS). 녹음기 미터링이나 표본에서 만든 것. */
  envelopeDb: number[];
  frameMs: number;
  text: string;
  /** 같은 간격의 음높이(Hz, 0 = 무성). 없으면 억양을 보지 않는다. */
  pitchHz?: number[];
  match?: LineMatch | null;
};

export function syllableCount(text: string): number {
  return (text.match(/[가-힣]/g) ?? []).length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

const round1 = (x: number) => Math.round(x * 10) / 10;

type Region = { start: number; end: number; max: number };

/**
 * 말한 덩어리들. 짧은 틈(150ms 미만)은 잇고 짧은 소리(100ms 미만)는 버린다. 앞뒤에서 1초 넘게 떨어져 있고 가장 큰
 * 소리보다 8dB 넘게 작은 덩어리는 대사가 아니라 넘기기 소리·삑 같은 것으로 보고 뺀다 — 실기기 녹음 대부분이
 * "대사 → 2초 무음 → 작은 소리"로 끝났다.
 */
function speechRegions(env: number[], voiced: boolean[], frameMs: number, peak: number): Region[] {
  const raw: Region[] = [];
  for (let i = 0; i < voiced.length; i += 1) {
    if (!voiced[i]) continue;
    const prev = raw[raw.length - 1];
    if (prev && (i - prev.end - 1) * frameMs < 150) {
      prev.end = i;
      prev.max = Math.max(prev.max, env[i]);
    } else raw.push({ start: i, end: i, max: env[i] });
  }
  const regions = raw.filter((r) => (r.end - r.start + 1) * frameMs >= 100);
  const stray = (r: Region, gapFrames: number) => gapFrames * frameMs >= 1000 && r.max < peak - 8;
  while (regions.length > 1 && stray(regions[regions.length - 1], regions[regions.length - 1].start - regions[regions.length - 2].end - 1)) regions.pop();
  while (regions.length > 1 && stray(regions[0], regions[1].start - regions[0].end - 1)) regions.shift();
  return regions;
}

/** 한 줄의 소리를 본다. 말한 구간이 거의 없으면 null(칩을 보이지 않는다). */
export function analyzeVoice(input: VoiceFeedbackInput): VoiceFeedback | null {
  const T = VOICE_FEEDBACK_THRESHOLDS;
  const env = input.envelopeDb.filter((x) => Number.isFinite(x));
  if (env.length < 5) return null;
  const floor = percentile(env, 10);
  const peak = percentile(env, 95);
  const snrDb = peak - floor;
  const gate = Math.max(floor + Math.min(10, snrDb / 2), peak - 30);
  const voiced = input.envelopeDb.map((x) => Number.isFinite(x) && x > gate);
  const regions = speechRegions(input.envelopeDb, voiced, input.frameMs, peak);
  if (regions.length === 0) return null;
  const first = regions[0].start;
  const last = regions[regions.length - 1].end;
  const span = last - first + 1;
  const speechMs = span * input.frameMs;
  if (speechMs < T.minSpeechMs || snrDb < 3) return null;

  const longPauses: number[] = [];
  for (let i = 1; i < regions.length; i += 1) {
    const gapMs = (regions[i].start - regions[i - 1].end - 1) * input.frameMs;
    if (gapMs >= T.pauseMs) longPauses.push(gapMs);
  }

  let endDropDb: number | null = null;
  if (speechMs >= T.endDropMinMs) {
    const seg = input.envelopeDb.slice(first, last + 1);
    const mid = seg.slice(Math.floor(span * 0.2), Math.floor(span * 0.8));
    const end = seg.slice(Math.floor(span * 0.8));
    endDropDb = round1(percentile(mid, 75) - percentile(end, 75));
  }

  const syl = syllableCount(input.text);
  const talkMs = speechMs - longPauses.reduce((a, b) => a + b, 0);
  const sps = syl >= 3 && talkMs > 0 ? round1(syl / (talkMs / 1000)) : null;

  let pitchRangeSt: number | null = null;
  if (input.pitchHz && speechMs >= 1_500) {
    const hz = input.pitchHz.slice(first, last + 1).filter((x) => x > 0);
    if (hz.length >= 10) {
      const median = percentile(hz, 50);
      const st = hz.map((x) => 12 * Math.log2(x / median));
      pitchRangeSt = round1(percentile(st, 90) - percentile(st, 10));
    }
  }

  const closeness = input.match && (input.match.kind === 'pass' || input.match.kind === 'miss') ? input.match.closeness : null;

  const chips = new Set<FeedbackChip>();
  if (closeness !== null && closeness < T.unclearCloseness) chips.add('unclear');
  if (snrDb < T.minSnrDb) chips.add('quiet');
  if (endDropDb !== null && endDropDb >= T.endDropDb) chips.add('end_drop');
  if (sps !== null && sps > T.fastSps) chips.add('fast');
  if (sps !== null && sps < T.slowSps) chips.add('slow');
  if (pitchRangeSt !== null && pitchRangeSt < T.flatSt) chips.add('flat');
  if (longPauses.length > 0) chips.add('pauses');

  return {
    metrics: { speechMs, snrDb: round1(snrDb), endDropDb, sps, pitchRangeSt, longPauses, closeness },
    chips: CHIP_ORDER.filter((c) => chips.has(c)).slice(0, MAX_CHIPS),
  };
}

/** 표본 → 고른 간격의 크기(dBFS). */
export function envelopeFromSamples(samples: Float32Array, sampleRate: number, frameMs = 20): number[] {
  const size = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const out: number[] = [];
  for (let at = 0; at + size <= samples.length; at += size) {
    let sum = 0;
    for (let i = at; i < at + size; i += 1) sum += samples[i] * samples[i];
    out.push(20 * Math.log10(Math.max(Math.sqrt(sum / size), 1e-6)));
  }
  return out;
}

/** 16kHz 안팎으로 솎는다 — 음높이 계산을 가볍게. */
function decimate(samples: Float32Array, sampleRate: number): { samples: Float32Array; sampleRate: number } {
  const step = Math.max(1, Math.floor(sampleRate / 16000));
  if (step === 1) return { samples, sampleRate };
  const out = new Float32Array(Math.floor(samples.length / step));
  for (let i = 0; i < out.length; i += 1) {
    let s = 0;
    for (let k = 0; k < step; k += 1) s += samples[i * step + k];
    out[i] = s / step;
  }
  return { samples: out, sampleRate: sampleRate / step };
}

/** 프레임마다 음높이(Hz, 0 = 무성). 정규화 자기상관, 75~500Hz. */
export function pitchTrack(input: Float32Array, inputRate: number, frameMs = 20): number[] {
  const { samples, sampleRate } = decimate(input, inputRate);
  const hop = Math.round((sampleRate * frameMs) / 1000);
  const win = hop * 2;
  const minLag = Math.floor(sampleRate / 500);
  const maxLag = Math.ceil(sampleRate / 75);
  const out: number[] = [];
  for (let at = 0; at + hop <= samples.length; at += hop) {
    if (at + win + maxLag > samples.length) { out.push(0); continue; }
    let energy = 0;
    for (let i = 0; i < win; i += 1) energy += samples[at + i] * samples[at + i];
    if (energy / win < 1e-6) { out.push(0); continue; }
    const corr = new Float32Array(maxLag + 1);
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let num = 0;
      let e2 = 0;
      for (let i = 0; i < win; i += 1) {
        const b = samples[at + i + lag];
        num += samples[at + i] * b;
        e2 += b * b;
      }
      corr[lag] = num / Math.sqrt(energy * e2 + 1e-12);
      if (corr[lag] > best) best = corr[lag];
    }
    // 배수 주기(한 옥타브 아래)를 잡지 않게, 최고에 가까운 봉우리 중 가장 짧은 주기를 고른다.
    let bestLag = 0;
    for (let lag = minLag + 1; lag < maxLag; lag += 1) {
      if (corr[lag] >= best * 0.9 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) { bestLag = lag; break; }
    }
    out.push(best > 0.6 && bestLag > 0 ? sampleRate / bestLag : 0);
  }
  return out;
}

/**
 * 인식기가 남긴 wav 를 표본으로. 안드로이드 16bit 정수, iOS 32bit 실수 PCM 을 받는다. 소리가 없거나 읽을 수
 * 없으면 null.
 */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let format = 0;
  let channels = 1;
  let sampleRate = 0;
  let bits = 0;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true) || 1;
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && body + 26 <= bytes.length) format = view.getUint16(body + 24, true);
    }
    if (id === 'data') {
      const end = Math.min(bytes.length, body + size);
      const width = bits / 8;
      const frames = Math.floor((end - body) / (width * channels));
      if (frames <= 0 || !sampleRate) return null;
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) {
        const o = body + i * width * channels;
        if (format === 1 && bits === 16) samples[i] = view.getInt16(o, true) / 32768;
        else if (format === 3 && bits === 32) samples[i] = view.getFloat32(o, true);
        else return null;
      }
      return { samples, sampleRate };
    }
    at = body + size + (size & 1);
  }
  return null;
}
