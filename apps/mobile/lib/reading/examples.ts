/**
 * 예시 대본 목록(reading.script 「예시 대본」). 서버가 미리 나눠 둔 예시를 받아 화면 모양으로 바꾸고, 못 받으면
 * (옛 서버의 404 포함) 앱에 내장된 예시(sample.ts)로 대신 보여 준다. 출처(source)에 따라 고른 뒤 길이 갈린다 —
 * server 는 서버 복사(start), local 은 지금처럼 대본 넣기(/reading/new?sample=).
 */
import { dialogueCount, SAMPLE_SCRIPTS, samplePreview } from './sample.ts';

export type ExamplePreviewLine = { speaker: string | null; text: string };

/** GET /v2/reading/examples 응답. */
export type ReadingExampleListResponse = {
  examples: {
    id: string;
    title: string;
    summary: string;
    dialogue_count: number;
    characters: string[];
    preview: ExamplePreviewLine[];
  }[];
};

/** POST /v2/reading/examples/{id}/start 응답. 처음 복사면 created=true(201), 이미 복사해 둔 게 있으면 false(200). */
export type ReadingExampleStart = { script_id: string; created: boolean };

export type ExampleEntry = {
  id: string;
  title: string;
  summary: string;
  dialogueCount: number;
  characters: string[];
  preview: ExamplePreviewLine[];
};

export type ExampleSource = 'server' | 'local';
export type ExampleList = { source: ExampleSource; examples: ExampleEntry[] };

const PREVIEW_MAX = 5;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function previewOf(raw: unknown): ExamplePreviewLine[] {
  if (!Array.isArray(raw)) return [];
  const out: ExamplePreviewLine[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !nonEmpty(item.text)) continue;
    out.push({ speaker: nonEmpty(item.speaker) ? item.speaker : null, text: item.text });
    if (out.length >= PREVIEW_MAX) break;
  }
  return out;
}

/** 서버 응답 → 화면 목록. id·제목 없는 항목은 버린다. 모양이 틀리면 빈 목록. */
export function normalizeExamples(body: unknown): ExampleEntry[] {
  if (!isRecord(body) || !Array.isArray(body.examples)) return [];
  const out: ExampleEntry[] = [];
  for (const item of body.examples) {
    if (!isRecord(item) || !nonEmpty(item.id) || !nonEmpty(item.title)) continue;
    const count = item.dialogue_count;
    out.push({
      id: item.id,
      title: item.title,
      summary: typeof item.summary === 'string' ? item.summary : '',
      dialogueCount: typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
      characters: Array.isArray(item.characters) ? item.characters.filter(nonEmpty) : [],
      preview: previewOf(item.preview),
    });
  }
  return out;
}

/** 앱에 내장된 예시 — 서버 목록을 못 받았을 때와 받는 동안 보여 준다. */
export function localExamples(): ExampleList {
  return {
    source: 'local',
    examples: SAMPLE_SCRIPTS.map((s) => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      dialogueCount: dialogueCount(s),
      characters: [],
      preview: samplePreview(s, PREVIEW_MAX),
    })),
  };
}

/** 서버 목록을 받아 본다. 어떤 실패든, 빈 목록이든 내장 목록(local)으로 돌아간다. */
export async function loadExamples(fetchList: () => Promise<unknown>): Promise<ExampleList> {
  try {
    const examples = normalizeExamples(await fetchList());
    if (examples.length > 0) return { source: 'server', examples };
  } catch {
    // 옛 서버(404)·연결 끊김 — 내장 예시로 그대로 쓸 수 있다.
  }
  return localExamples();
}
