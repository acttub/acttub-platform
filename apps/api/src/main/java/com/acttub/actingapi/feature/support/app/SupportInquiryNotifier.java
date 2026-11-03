package com.acttub.actingapi.feature.support.app;

import java.util.UUID;

/**
 * 새 문의를 팀에 알린다(11/3 사용자 「slack에 받자」). 알림이 실패해도 접수는 그대로다 — 구현은 예외를 밖으로 던지지 않는다.
 * 메일 주소는 넘기지 않는다(개인정보는 문의함에만).
 */
public interface SupportInquiryNotifier {

    record Notice(UUID id, String category, String body, boolean member, String client) {
    }

    void accepted(Notice notice);

    SupportInquiryNotifier NONE = notice -> { };
}
