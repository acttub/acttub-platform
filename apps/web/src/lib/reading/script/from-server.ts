/**
 * 서버가 돌려준 대본을 화면이 쓰는 모양으로. 리딩 실행 화면과 상태 머신은 배역 이름으로
 * 줄을 가르므로 배역 id 를 이름으로 풀고, 회차 시작·진행 저장이 배역·줄 id 를 쓰도록 id 는 따로 든다.
 */
import type { ScriptDetail } from "../api-types";
import type { StoredScript } from "../storage";
import type { ScriptLine } from "./parse";

export function toStoredScript(detail: ScriptDetail): StoredScript {
  const characters = [...detail.characters].sort((a, b) => a.order - b.order);
  const nameOf = new Map(characters.map((c) => [c.id, c.name]));
  const sorted = [...detail.lines].sort((a, b) => a.ordinal - b.ordinal);
  const lines: ScriptLine[] = sorted.map((l) => {
    const role = l.character_id === null ? undefined : nameOf.get(l.character_id);
    if (l.kind === "dialogue" && role !== undefined) return { type: "dialogue", role, text: l.text };
    if (l.kind === "scene") return { type: "scene", text: l.text };
    return { type: "direction", text: l.text };
  });
  return {
    id: detail.id,
    title: detail.title,
    roles: characters.map((c) => c.name),
    lines,
    characters: characters.map((c) => ({ id: c.id, name: c.name, voicePreset: c.voice_preset })),
    lineIds: sorted.map((l) => l.id),
    openSessionId: detail.open_session_id,
    lastSession: detail.last_session
      ? { id: detail.last_session.id, status: detail.last_session.status, myCharacterIds: detail.last_session.my_character_ids }
      : null,
  };
}
