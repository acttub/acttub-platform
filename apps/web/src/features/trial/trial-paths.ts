/**
 * 웹 체험(가입 없이 써 보기, SOMA-834 3차)의 주소와 들어온 길.
 * 광고·검색 링크는 READING_TRIAL_PATH 에 UTM 만 붙여 보낸다. 사이트 안 링크는 `from` 으로 어디서 눌렀는지를 더한다.
 */
import { storeCampaignParams } from "@/lib/app-download/store-links";
import type { TrialEntry } from "@/lib/analytics/ga";

/** 대본 리딩 빠른 시작. 예시 대본을 불러와 배역만 고르고 바로 리딩으로 간다. */
export const READING_TRIAL_PATH = "/reading/try";

/** 연기 코칭 시작(영상 올리기) 화면. */
export const COACHING_TRIAL_PATH = "/practice/new";

const FROM_VALUES: readonly TrialEntry[] = ["home_card", "nav", "keyword_page", "coaching_link"];

/** 사이트 안에서 눌렀을 때 붙는 `from` 값. 모르는 값이면 광고·검색으로 곧장 들어온 것으로 본다. */
export function trialEntryFromSearch(search: string): TrialEntry {
  const from = new URLSearchParams(search).get("from");
  return FROM_VALUES.find((value) => value === from) ?? "quick_start";
}

/**
 * 체험 주소. 지금 주소의 허용된 캠페인 값(UTM)을 그대로 실어 사이트 안 이동에서도 다운로드 귀속이 이어지게 한다.
 * `from` 은 퍼널을 나누는 용도라 캠페인 값과 섞이지 않는다.
 */
export function trialHref(path: string, from: Exclude<TrialEntry, "quick_start" | "direct">, search = ""): string {
  const params = storeCampaignParams(search);
  params.set("from", from);
  return `${path}?${params.toString()}`;
}
