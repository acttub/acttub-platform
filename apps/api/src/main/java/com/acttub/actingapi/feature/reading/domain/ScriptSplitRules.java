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

    /**
     * 한 작업이 동시에 보내는 호출 수의 상한. 4,256줄은 조각 29개라 두 묶음이 된다 — 작업 넷이 함께 돌아도 OpenAI 로 나가는
     * 동시 호출이 64를 넘지 않는다(Tier 1 분당 500회).
     */
    public static final int PARALLEL_CALLS = 16;

    /** 빠지거나 버린 줄을 다시 묻는 횟수. 그래도 남으면 지문이다. */
    public static final int MISSING_ROUNDS = 2;

    /** 빠진 줄을 다시 물을 때 그 줄 앞뒤로 함께 보내는 문맥 줄 수. 블록 형식의 이름 줄·앞선 화자를 보게 한다(SOMA-663). */
    public static final int MISSING_CONTEXT_LINES = 4;

    /** 호출 하나의 재시도 횟수(연결 실패·429·5xx·미완료). 소진하면 작업이 {@code failed} 다. */
    public static final int CALL_RETRIES = 2;

    /** 시험·결정의 모델. 코치의 기본 모델({@code OpenAiResponsesClient})과 다르고 호출마다 넘긴다. */
    public static final String MODEL = "gpt-6-luna";
    public static final String REASONING_EFFORT = "low";
    public static final int MAX_OUTPUT_TOKENS = 128_000;

    /**
     * 줄 두 번째 의견(Jev, SOMA-663 J1·J2). 문턱(대사로·다른 종류로 바꾸기 0.4, 대사를 다른 종류로 내리기 0.75, 화자 0.9)은 개발 대본
     * 반반 두 겹 교차(오류 대본 수)로 골랐다. 화자 문턱이 낮으면 지점은 더 고치지만 같은 사람이 갈려 대본 단위로는 나빠진다.
     * 동시 16이면 1만 자(약 370줄) 대본 8편의 Jev 벽시계가 중앙 9.5초·최대 12.3초였다. Jev 화자가 위쪽 가장 가까운 화자 머리와 같을 때의
     * 문턱 0.8(SOMA-663 C2)은 홀짝 두 겹 교차로 정해지지 않았다(홀 반은 0.5~0.8이 0.9보다 낫고 짝 반은 0.5~0.9가 같다). 0.6~0.8은 개발
     * 오류 대본 수가 같아서, 채점하지 않는 바뀐 줄을 원문과 대조했을 때 맞힌 줄이 더 많은 0.8 이상 구간만 쓴다.
     */
    public static final LineReview.Settings REVIEW = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 0.8, 16);
    /**
     * 서버 전체에서 OpenRouter 로 동시에 나가는 Jev 질문의 상한. 1만 자 대본 8편을 한꺼번에(동시 128 요구) 돌리면 상한 128은 재시도
     * 뒤에도 0.7%가 429 로 남았고, 64는 0건·대본당 나누기 포함 최대 59초, 32는 0건이지만 줄을 서서 최대 77초였다.
     */
    public static final int REVIEW_IN_FLIGHT = 64;
    /**
     * 배역 후보 판단(Jev, SOMA-663 R2, {@link SpeakerMerge})의 답을 적용하는 확신 하한. 2026-10-21 개발 159편 대본 번호 순 짝·홀 두 겹
     * 교차(오류 대본 수)에서 두 반 모두 0.4~0.7 이 최소였다(한 반은 0.8 까지) — 겹치는 가장 높은 값을 쓴다. 0.7 에서 적용된 답 28개 중
     * 기준 배역과 어긋난 것은 「운전자 2」→「운전자기」(글자 인식으로 「1」이 「기」가 된 다른 사람) 하나였다. 장면 참여자를 근거에 넣고 두 번 물어
     * 평균한 뒤(R2b, 통합 브랜치 위)에는 0.7 에서 적용된 답 18개가 모두 기준과 맞았다. 교차에서 두 반의 최소 구간은 0.6 에서만 겹쳤지만(오류
     * 대본 하나 더 적음) 0.6 이면 「여학생2」→「학생2」 같은 다른 사람이 합쳐져 0.7 을 둔다.
     */
    public static final double SAME_SPEAKER_MIN = 0.7;
    public static final String REVIEW_MODEL = "typesafe/jev-1.14-20261014";

    /**
     * 이름 없는 대사로 다시 나눠 통과한 글을 Jev 「말하는 글」 확신이 이보다 낮으면 거절한다(SOMA-663 H1). 2026-10-20 개발 묶음 무명 대본 9편의
     * 최저 0.62(153)와 합성 비대본 12편의 「말하는 글」 최고 0.22(구어 상품평) 사이다 — 표본 21편으로 정했다.
     */
    public static final double SPEECH_MIN = 0.5;
    /** Jev 에 보내는 글의 앞부분 글자 수. */
    public static final int SPEECH_STATE_CHARS = 3_000;

    private ScriptSplitRules() {
    }
}
