package com.acttub.actingapi.feature.audition.app;

import java.time.LocalDate;
import java.util.List;

import com.acttub.actingapi.feature.audition.domain.AuditionPosting;

/**
 * 출처의 목록 페이지·RSS 를 읽어 오는 바깥 의존(네트워크). 목록만 열고 상세 페이지는 열지 않는다. 출처가 답하지 않거나
 * 목록 구조가 바뀌었으면 예외를 던진다 — 부르는 쪽이 External Failure 로 보고하고 다음 출처로 간다.
 */
public interface AuditionSources {

    /** {@code today}(KST) 는 시각만 적힌 게시일을 날짜로 읽을 때 쓴다. */
    List<AuditionPosting> read(String source, LocalDate today);
}
