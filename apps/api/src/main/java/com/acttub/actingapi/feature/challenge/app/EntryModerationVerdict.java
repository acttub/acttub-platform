package com.acttub.actingapi.feature.challenge.app;

/**
 * 공개 참여작 AI 검사의 판정 (SOMA-907).
 *
 * @param decision pass(그대로) · hide(숨기고 운영 확인) · review(보이게 두고 운영 확인)
 * @param category 판정 근거의 종류. 통과면 none
 * @param reason   운영이 볼 한 문장(사람을 묘사하지 않는다)
 */
public record EntryModerationVerdict(Decision decision, String category, String reason) {
    public enum Decision { PASS, HIDE, REVIEW }

    /** 신고 목록의 사유 칸(entry_reports.reason)에 맞춘다. */
    public String reportReason() {
        return switch (category) {
            case "spam" -> "spam";
            case "unrelated", "other", "none" -> "other";
            default -> "inappropriate";
        };
    }

    /** 신고 목록의 메모 칸. 200자를 넘지 않는다. */
    public String reportNote() {
        String label = decision == Decision.HIDE ? "AI 검사: 숨김" : "AI 검사: 확인 필요";
        return clip(label + " (" + category + ") " + (reason == null ? "" : reason));
    }

    public static String failureNote() {
        return "AI 검사 실패: 판정을 받지 못해 영상은 공개 상태예요. 직접 확인해 주세요.";
    }

    static String clip(String value) {
        return value.codePointCount(0, value.length()) <= 200 ? value
                : value.substring(0, value.offsetByCodePoints(0, 199)) + "…";
    }
}
