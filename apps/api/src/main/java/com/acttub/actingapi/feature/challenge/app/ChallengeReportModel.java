package com.acttub.actingapi.feature.challenge.app;

import java.util.List;

/**
 * AI 리포트를 만드는 모델 (challenge.ai-report). 입력은 영상과 챌린지 대사뿐이다 — 코치 대화·장면 입력·배우 기억은
 * 이 포트에 실을 자리가 없다. 표본 영상은 라벨(S1…)로만 넘기고 사람의 이름·id 를 주지 않는다.
 */
public interface ChallengeReportModel {
    /**
     * @param mine    요청한 배우의 영상
     * @param samples 표본 영상과 그 라벨(같은 순서)
     */
    Output generate(AiReportRepository.Video mine, List<Labeled> samples, String instruction);

    record Labeled(String label, AiReportRepository.Video video) { }
    record Output(String text, String model) { }
}
