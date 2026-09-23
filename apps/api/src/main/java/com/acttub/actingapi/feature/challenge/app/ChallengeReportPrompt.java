package com.acttub.actingapi.feature.challenge.app;

import com.acttub.actingapi.feature.challenge.domain.ChallengeReportRules;

/** AI 리포트의 지시문 (challenge.ai-report). 채점 금지(ADR-005)와 출력 모양을 모델에게 알린다. */
public final class ChallengeReportPrompt {
    private ChallengeReportPrompt() { }

    public static String instruction(String line, int samples) {
        boolean compare = samples >= ChallengeReportRules.MIN_SAMPLES;
        return """
                너는 연기 영상을 관찰해 설명하는 사람이다. 첫 영상은 리포트를 요청한 배우의 영상이다.%s
                모두 같은 대사를 연기했다. 대사: «%s»

                지킬 것:
                - 점수·백분위·등급·순위·우열·칭찬("잘했어요" 같은 말)·재능·합격 가능성을 말하지 않는다.
                - 영상에서 확인한 것(발화 속도·멈춤·강세·시선·표정·몸의 움직임)만 쓰고 보지 못한 것은 추측하지 않는다.
                - 다른 영상의 사람을 특정하거나 묘사로 알아볼 수 있게 쓰지 않는다. "다른 참여작들"로만 부른다.
                - 한국어로 쓴다.

                JSON 하나만 낸다:
                {"observations":[{"start_ms":정수,"end_ms":정수,"text":"내 영상에서 확인한 것"}],
                 "comparisons":[{"text":"다른 참여작들에서 자주 보인 선택과 내 선택의 차이(우열 없이)","samples":["S1"]}],
                 "limits":["못 본 구간이나 판단할 수 없던 것"],
                 "suggestion":"다음에 해 볼 것 하나 또는 null"}
                %s""".formatted(
                compare ? " 뒤의 영상들(S1…S" + samples + ")은 같은 챌린지의 다른 참여작들이다." : "",
                line,
                compare ? "comparisons 의 samples 에는 그 문장의 근거가 된 라벨을 적는다."
                        : "비교할 다른 영상이 없으니 comparisons 는 빈 배열로 둔다.");
    }
}
