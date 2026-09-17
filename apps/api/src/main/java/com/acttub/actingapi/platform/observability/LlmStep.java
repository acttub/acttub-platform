package com.acttub.actingapi.platform.observability;

/**
 * 모델을 부르는 자리. 이름이 그대로 기록의 이름이 되므로 바꾸면 지난 기록과 갈린다.
 *
 * <p><b>코치의 1차와 재생성을 따로 두는 것이 이 목록의 핵심이다.</b> 둘은 같은 메서드를
 * 부르지만 뜻이 다르다 — 재생성은 1차 응답이 서버 검증에 걸렸다는 뜻이고, 그 비율이 곧
 * 품질 지표다. 지금은 둘이 원장({@code external_operations}) 한 행에 묻혀 사후에 셀
 * 방법이 없다.
 */
public enum LlmStep {
    /** 영상을 보고 관찰을 낸다 (Gemini). */
    OBSERVATION("observation"),
    /** 소리에서 대사를 받아쓴다 (Gemini). */
    TRANSCRIPTION("transcription"),
    /** 코치의 첫 응답. */
    COACH_TURN("coach.turn"),
    /** 1차 응답이 검증에 걸려 다시 낸 응답. */
    COACH_REGENERATION("coach.regeneration"),
    /** 연습 노트. */
    REPORT("report"),
    /** 배우에 대해 적어 둘 것을 뽑는다. */
    MEMORY_EXTRACTION("memory.extraction");

    private final String spanName;

    LlmStep(String spanName) {
        this.spanName = spanName;
    }

    public String spanName() {
        return spanName;
    }
}
