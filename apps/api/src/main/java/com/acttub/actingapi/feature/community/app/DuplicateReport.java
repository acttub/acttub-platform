package com.acttub.actingapi.feature.community.app;

/**
 * 같은 사람이 같은 대상을 이미 신고했다.
 *
 * <p>미리 세어 보고 막지 않고 유니크 제약 위반을 받아 옮긴다 — 확인과 삽입 사이에 다른 요청이
 * 끼어들 수 있어서다.
 */
public class DuplicateReport extends RuntimeException {

    public DuplicateReport(Throwable cause) {
        super(cause);
    }
}
