package com.acttub.actingapi.feature.consent.app;

import java.util.List;

import com.acttub.actingapi.feature.consent.domain.ConsentNotice;

/**
 * consent 가 고지 문서의 보관처에 요구하는 것. 고지는 DB 가 아니라 배포에 든 파일이다 — 판도 결정도
 * 없어 행으로 둘 이유가 없다.
 */
public interface ConsentNoticeSource {

    /** 공개 페이지에 싣는 순서 그대로. */
    List<ConsentNotice> notices();
}
