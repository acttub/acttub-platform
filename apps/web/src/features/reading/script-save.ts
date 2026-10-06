/**
 * 대본 넣기가 끝났을 때와 목록 카드의 "열기" 가 하는 일. 서버의 대본을 기기 캐시에 두고, 이전 대본의
 * 설정·결과를 버린다. 화면은 이것을 부르고 결과로 옮겨 가기만 한다.
 */
import type { ScriptDetail } from "@/lib/reading/api-types";
import { toStoredScript } from "@/lib/reading/script/from-server";
import { storage, type StoredScript } from "@/lib/reading/storage";

/** 서버가 돌려준 대본을 지금 대본으로 든다. 다른 대본이므로 하던 회차·결과는 버린다. */
export function adoptScript(detail: ScriptDetail): StoredScript {
  return adoptStoredScript(toStoredScript(detail));
}

/** 이미 화면 모양으로 바꾼 대본(상세 화면이 받은 것)을 지금 대본으로 든다. */
export function adoptStoredScript(stored: StoredScript): StoredScript {
  storage.saveScript(stored);
  storage.saveSession(null);
  storage.saveStats(null);
  return stored;
}
