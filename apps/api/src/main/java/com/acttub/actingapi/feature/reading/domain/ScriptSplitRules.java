package com.acttub.actingapi.feature.reading.domain;

/**
 * 대본 나누기의 숫자 (reading.script 「나누기 작업」). 2026-10-02 운영 대본 68편 실측(SOMA-593 7-1)으로 정했다.
 */
public final class ScriptSplitRules {

    /** 한 사람이 하루(한국 날짜)에 LLM 을 부를 수 있는 나누기 수. 예시 대본·중복은 세지 않는다. */
    public static final int DAILY_IMPORTS = 20;

    /** 모델에 한 번에 보내는 줄 수. 300·600 보다 가장 긴 대본에서 빨랐다(24초·28초·34초). */
    public static final int CHUNK_LINES = 150;

    /** 조각이 둘 이상이면 앞 이만큼으로 배역 목록을 먼저 받는다. 없으면 화자 빈 대사가 458줄이었다. */
    public static final int ROSTER_LINES = 400;

    /** 빠지거나 버린 줄을 다시 묻는 횟수. 그래도 남으면 지문이다. */
    public static final int MISSING_ROUNDS = 2;

    /** 호출 하나의 재시도 횟수(연결 실패·429·5xx·미완료). 소진하면 작업이 {@code failed} 다. */
    public static final int CALL_RETRIES = 2;

    /** 시험·결정의 모델. 코치의 기본 모델({@code OpenAiResponsesClient})과 다르고 호출마다 넘긴다. */
    public static final String MODEL = "gpt-6-luna";
    public static final String REASONING_EFFORT = "low";
    public static final int MAX_OUTPUT_TOKENS = 128_000;

    private ScriptSplitRules() {
    }
}
