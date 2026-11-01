/**
 * 대본 리딩 빠른 시작(/reading/try, SOMA-834 3차). 광고·검색·홈 카드에서 들어온 방문자가 대본 넣기와 배역 정하기를
 * 건너뛰고 예시 대본(SAMPLE_SCRIPT)으로 바로 리딩 화면에 가게 한다. 서버·저장소 흐름은 기존 대본 넣기와 같다 —
 * 예시 대본을 서버가 나눠 저장하고(게스트 계정에 생긴다), 회차를 만들어 실행 화면으로 간다.
 */
import type { SessionCreateRequest } from "@/lib/reading/api-types";
import { toStoredScript } from "@/lib/reading/script/from-server";
import { newAttempt, runImport } from "@/lib/reading/script/import";
import { SAMPLE_SCRIPT } from "@/lib/reading/script/sample";
import type { StoredScript } from "@/lib/reading/storage";
import { adoptStoredScript } from "@/features/reading/script-save";
import { buildSessionRequest } from "@/features/reading/session-start";
import type { ScriptImportDeps } from "@/features/reading/use-script-import";

/** 예시 대본의 두 배역. 처음에는 윤서로 읽는다. */
export const QUICK_START_ROLES = ["윤서", "태오"] as const;
export type QuickStartRole = (typeof QUICK_START_ROLES)[number];
export const QUICK_START_DEFAULT_ROLE: QuickStartRole = "윤서";

/** 이 기기에서 만든 예시 대본의 서버 id. 다시 들어오면 새로 나누지 않고 같은 대본을 쓴다. */
export const SAMPLE_SCRIPT_KEY = "acttub.reading.sample_script_id";

export const QUICK_START_COPY = {
  preparing: "예시 대본을 준비하고 있어요",
  preparingNote: "잠시만 기다리면 리딩 화면으로 가요.",
  failed: "예시 대본을 준비하지 못했어요. 다시 시도해 주세요.",
  retry: "다시 시도",
  own: "내 대본으로 하기",
} as const;

/** `?role=` 값에서 배역. 모르는 값이면 윤서. 영문 표기(yoonseo·taeo)도 받는다. */
export function quickStartRoleFromSearch(search: string): QuickStartRole {
  const role = new URLSearchParams(search).get("role")?.trim().toLowerCase();
  return role === "태오" || role === "taeo" ? "태오" : QUICK_START_DEFAULT_ROLE;
}

export function otherQuickStartRole(role: QuickStartRole): QuickStartRole {
  return role === "윤서" ? "태오" : "윤서";
}

/** 배역을 바꾸는 주소. 사이트 안에서 눌러 들어온 빠른 시작이므로 `from` 은 붙이지 않는다. */
export function quickStartPath(role: QuickStartRole): string {
  return role === QUICK_START_DEFAULT_ROLE ? "/reading/try" : "/reading/try?role=taeo";
}

type IdStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): IdStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 지금 대본이 이 기기의 예시 대본인가 — 실행 화면이 배역 바꾸기 링크를 그릴지 정한다. */
export function isSampleScript(script: Pick<StoredScript, "id">, store: IdStore | null = browserStore()): boolean {
  try {
    return store?.getItem(SAMPLE_SCRIPT_KEY) === script.id;
  } catch {
    return false;
  }
}

export interface PrepareDeps {
  importDeps: ScriptImportDeps;
  store?: IdStore | null;
  /** 이미 기기에 들고 있는 대본(캐시). 같은 예시 대본이면 서버를 부르지 않는다. */
  cached?: StoredScript | null;
  signal?: AbortSignal;
}

/**
 * 예시 대본을 지금 대본으로 만든다. 순서: 기기 캐시 → 저장해 둔 id 로 서버 조회 → 새로 나누기.
 * 이미 같은 대본이 있다는 알림(duplicate)은 실패가 아니라 그 대본을 쓰라는 뜻이다.
 */
export async function prepareSampleScript({ importDeps, store = browserStore(), cached = null, signal }: PrepareDeps): Promise<StoredScript> {
  const knownId = (() => {
    try {
      return store?.getItem(SAMPLE_SCRIPT_KEY) ?? null;
    } catch {
      return null;
    }
  })();
  if (knownId && cached?.id === knownId) return adoptStoredScript(cached);
  if (knownId) {
    try {
      return adoptStoredScript(toStoredScript(await importDeps.getScript(knownId, { signal })));
    } catch {
      // 서버에서 지워졌거나 못 불렀다 — 아래에서 새로 만든다.
    }
  }
  const { outcome } = await runImport(newAttempt({ kind: "text", text: SAMPLE_SCRIPT, source: "sample" }), importDeps, () => {});
  if (outcome.kind !== "saved" && outcome.kind !== "duplicate") throw new Error(`sample_import_${outcome.kind}`);
  const stored = adoptStoredScript(toStoredScript(await importDeps.getScript(outcome.scriptId, { signal })));
  try {
    store?.setItem(SAMPLE_SCRIPT_KEY, stored.id);
  } catch {
    // 저장소를 못 쓰면 다음에 다시 나눈다.
  }
  return stored;
}

/** 빠른 시작의 회차 요청. 읽어주기·전체 구간이고, 마이크가 되면 침묵 감지·녹음을 켠다. 대사가 없는 대본이면 null. */
export function quickStartRequest(
  script: StoredScript,
  role: QuickStartRole,
  mic: boolean,
): Omit<SessionCreateRequest, "request_id"> | null {
  const character = script.characters.find((c) => c.name === role) ?? script.characters[0];
  if (!character) return null;
  return buildSessionRequest(script, {
    myCharacterIds: [character.id],
    mode: "read",
    advance: mic ? "silence" : "manual",
    record: mic,
    mask: "show_all",
  });
}
