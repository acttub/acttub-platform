import type { PracticeSessionDetail } from "../../lib/api/v2/types";

// 분석 실패 안내는 practice-flow(기록)와 practice-single(새 연습) 두 화면이 함께 쓴다.
// 한쪽에만 두면 같은 error_code를 두 화면이 다르게 설명하게 된다.
export function analysisFailure(errorCode: PracticeSessionDetail["error_code"]): {
  message: string;
  retryable: boolean;
} {
  switch (errorCode) {
    case "gemini_timeout":
      return { message: "분석 시간이 초과됐어요. 같은 영상으로 다시 시도할 수 있어요.", retryable: true };
    case "gemini_parse_error":
      return { message: "분석 결과를 정리하지 못했어요. 다시 시도해 주세요.", retryable: true };
    case "unsupported_media":
      return { message: "이 영상 형식은 분석할 수 없어요. 다른 영상으로 새 연습을 시작해 주세요.", retryable: false };
    case "max_attempts_exceeded":
      return { message: "재시도 한도를 모두 사용했어요. 새 연습을 시작해 주세요.", retryable: false };
    default:
      return { message: "영상 분석을 완료하지 못했어요. 같은 영상으로 다시 시도해 주세요.", retryable: true };
  }
}
