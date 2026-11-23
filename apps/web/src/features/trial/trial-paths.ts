/**
 * 웹 체험(가입 없이 써 보기, SOMA-834 3차)에 들어온 길.
 * 광고·검색 링크는 /reading/try 에 UTM 만 붙여 보낸다. 사이트 안 링크는 `from` 으로 어디서 눌렀는지를 더한다.
 */
import type { TrialEntry } from "@/lib/analytics/ga";

const FROM_VALUES: readonly TrialEntry[] = ["home_card", "nav", "keyword_page", "coaching_link", "app_page"];

/** 사이트 안에서 눌렀을 때 붙는 `from` 값. 모르는 값이면 광고·검색으로 곧장 들어온 것으로 본다. */
export function trialEntryFromSearch(search: string): TrialEntry {
  const from = new URLSearchParams(search).get("from");
  return FROM_VALUES.find((value) => value === from) ?? "quick_start";
}
