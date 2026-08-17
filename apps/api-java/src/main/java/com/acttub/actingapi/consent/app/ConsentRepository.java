package com.acttub.actingapi.consent.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.consent.domain.ConsentDocument;
import com.acttub.actingapi.consent.domain.ConsentEvent;

/**
 * consent 가 저장소에 요구하는 것 — 문서와 이력.
 *
 * <p>없음을 {@code null} 로 알린다(ADR-018). 이 포트의 연산은 전부 갈래가 하나다 —
 * {@code findDocument} 만 없을 수 있고, 나머지는 빈 목록이 곧 답이다.
 */
public interface ConsentRepository {

    /**
     * 종류마다 가장 최근 판 하나씩. <b>종류 순</b>이다.
     *
     * <p>이 순서가 곧 {@code /v2/consents/documents}·{@code /v2/consents/pending} 응답의 순서다.
     */
    List<ConsentDocument> listLatestDocuments();

    /** 없으면 {@code null}. */
    ConsentDocument findDocument(UUID documentId);

    /** 문서마다 이 사람의 <b>마지막</b> 행위 한 줄씩. */
    List<ConsentEvent> currentConsentsOf(UUID userId);

    ConsentEvent record(UUID userId, UUID documentId, String action, Instant occurredAt);
}
