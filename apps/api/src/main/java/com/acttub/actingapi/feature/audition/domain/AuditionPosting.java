package com.acttub.actingapi.feature.audition.domain;

import java.time.LocalDate;

/**
 * 출처 목록 페이지에서 읽은 공고 하나의 사실 항목(app.audition). 본문·포스터·작성자·담당자는 처음부터 칸이 없다.
 *
 * @param source     출처 코드({@link AuditionRules#SOURCES})
 * @param sourceRef  출처 안의 원문 번호. {@code (source, sourceRef)} 가 한 공고다
 * @param payText    출연료 문구 원문 그대로. 숫자로 바꾸지 않는다
 * @param statusText 원문의 상태 문구(접수마감·모집중 등)
 */
public record AuditionPosting(
        String source,
        String sourceRef,
        String title,
        String category,
        String payText,
        LocalDate applyStart,
        LocalDate applyEnd,
        String statusText,
        LocalDate postedOn,
        String sourceUrl) {

    /** 기기의 찜·봤음 저장 열쇠. */
    public String id() {
        return source + "-" + sourceRef;
    }
}
