package com.acttub.actingapi.feature.consent.app;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import com.acttub.actingapi.feature.consent.domain.ConsentDocument;
import com.acttub.actingapi.feature.consent.domain.ConsentEvent;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.stereotype.Service;

/**
 * 동의 문서 조회와 기록의 규칙.
 */
@Service
public class ConsentService {
    private final ConsentRepository consents;
    private final Clock clock;

    public ConsentService(ConsentRepository consents, Clock clock) {
        this.consents = consents;
        this.clock = clock;
    }

    public List<ConsentDocument> latestDocuments() {
        return consents.listLatestDocuments();
    }

    /**
     * 이 사람이 아직 받아야 하는 문서.
     *
     * <p>⚠ <b>로그인 응답에 실리는 목록과 같은 것을 세지만 순서가 다르다.</b> 이쪽은
     * {@link #latestDocuments} 를 걸러 <b>종류 순</b>으로 내고, 로그인 쪽
     * ({@code PostgresConsentRepository#pendingFor})은 한 문장의 SQL 로 <b>발행 시각 순</b>으로
     * 낸다. 둘 다 파이썬 정본이 그렇게 갈려 있어 그대로 뒀다 — 하나로 합치면 어느 한쪽의
     * 응답 순서가 바뀐다.
     */
    public List<ConsentDocument> pendingDocuments(UUID userId) {
        Map<UUID, String> lastActions = consents.currentConsentsOf(userId).stream()
                .collect(Collectors.toMap(ConsentEvent::documentId, ConsentEvent::action));
        return consents.listLatestDocuments().stream()
                .filter(document -> document.stillNeededBy(lastActions.get(document.id())))
                .toList();
    }

    /**
     * 동의·거절·철회를 기록한다. 덮어쓰지 않고 쌓는다 — 지금 상태는 마지막 한 줄로 정해진다.
     *
     * <p>가리키는 문서가 없으면 404 다. 식별자가 UUID 형태가 아닌 것도 <b>같은 404</b> 로
     * 답한다 — 형태만으로 실재 여부를 알려주지 않는다.
     */
    public ConsentEvent record(UUID userId, String rawDocumentId, String action) {
        UUID documentId;
        try {
            documentId = UUID.fromString(rawDocumentId);
        } catch (IllegalArgumentException notAUuid) {
            throw documentNotFound();
        }
        if (consents.findDocument(documentId) == null) {
            throw documentNotFound();
        }
        return consents.record(userId, documentId, action, clock.instant());
    }

    private static ApiException documentNotFound() {
        return new ApiException(404, "consent_document_not_found");
    }
}
