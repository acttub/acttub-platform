/**
 * 음소 단위 발음 채점(실험) — 줄 녹음을 채점 서버(slplab CTC-GOP)에 보내 "어느 어절의 어느 소리가 무엇처럼 들렸는지"를
 * 받는다. 주소(`EXPO_PUBLIC_PRON_URL`)가 없으면 꺼져 있다 — 지금은 개발 PC 의 시험 서버만 있다.
 */
export type PhoneNote = { expected: string; heard: string };
export type AcousticNote = { word: string; phones: PhoneNote[] };

const TIMEOUT_MS = 20_000;

export function pronunciationServerUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_PRON_URL;
  return url ? url.replace(/\/$/, '') : null;
}

export async function scorePronunciation(input: { uri: string; contentType: string; text: string }): Promise<AcousticNote[]> {
  const base = pronunciationServerUrl();
  if (!base) return [];
  const form = new FormData();
  const ext = input.contentType === 'audio/wav' ? 'wav' : 'm4a';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form.append('audio', { uri: input.uri, name: `line.${ext}`, type: input.contentType } as any);
  form.append('text', input.text);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/score`, { method: 'POST', body: form, signal: controller.signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { notes?: AcousticNote[] };
    return Array.isArray(body.notes) ? body.notes.filter((n) => n && typeof n.word === 'string' && Array.isArray(n.phones)) : [];
  } finally {
    clearTimeout(timer);
  }
}
