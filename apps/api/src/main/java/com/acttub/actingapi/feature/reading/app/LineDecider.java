package com.acttub.actingapi.feature.reading.app;

import java.util.Map;

import com.acttub.actingapi.feature.reading.domain.LineReview;
import com.acttub.actingapi.feature.reading.domain.SpeakerMerge;

/** 줄 하나의 종류·화자를 묻는 판단 모델(SOMA-663 J1). 호출이 끝내 실패하면 예외 — 나누기는 그 줄을 바꾸지 않고 이어 간다. */
public interface LineDecider {
    LineReview.Decision decide(LineReview.Question question);

    /** 글이 사람이 소리 내어 하는 말인가의 확신(SOMA-663 H1). 「말이 아닌 글」을 고르면 0. 실패하면 예외. */
    double speech(String text);

    /**
     * 배역 후보가 기존 역할·독립 배역·배역 아님·보류 중 무엇인가 — 보기 값 → 확률(SOMA-663 R2, {@link SpeakerMerge.Candidate#choices}). 실패하면 예외.
     *
     * @param reversed 보기 역할을 거꾸로 늘어놓고 묻는다
     */
    Map<String, Double> role(SpeakerMerge.Candidate candidate, boolean reversed);
}
