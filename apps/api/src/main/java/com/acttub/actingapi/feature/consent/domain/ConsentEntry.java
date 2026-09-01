package com.acttub.actingapi.feature.consent.domain;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 최신 동의 문서와 배우의 현재 동의 결정을 함께 보고 계산한 서비스 진입 판정.
 *
 * <p>저장하는 상태가 아니다. 최신 문서에 대한 현재 결정을 붙일 때마다 다시 계산한다.
 */
public record ConsentEntry(
        Status status,
        List<DocumentDecision> documents,
        List<DocumentDecision> undecidedDocuments) {

    public ConsentEntry {
        documents = List.copyOf(documents);
        undecidedDocuments = List.copyOf(undecidedDocuments);
    }

    public static ConsentEntry evaluate(
            List<ConsentDocument> latestDocuments,
            List<ConsentEvent> currentConsents) {
        Map<UUID, ConsentEvent> decisionsByDocument = new HashMap<>();
        for (ConsentEvent decision : currentConsents) {
            decisionsByDocument.put(decision.documentId(), decision);
        }

        List<DocumentDecision> documents = latestDocuments.stream()
                .map(document -> new DocumentDecision(
                        document,
                        decisionsByDocument.get(document.id())))
                .toList();
        List<DocumentDecision> undecidedDocuments = documents.stream()
                .filter(DocumentDecision::isUndecided)
                .toList();

        Status status;
        if (documents.stream().anyMatch(DocumentDecision::blocksService)) {
            status = Status.BLOCKED;
        } else if (!undecidedDocuments.isEmpty()) {
            status = Status.DECISION_REQUIRED;
        } else {
            status = Status.ALLOWED;
        }
        return new ConsentEntry(status, documents, undecidedDocuments);
    }

    public enum Status {
        ALLOWED,
        DECISION_REQUIRED,
        BLOCKED
    }

    public record DocumentDecision(
            ConsentDocument document,
            ConsentEvent currentDecision) {

        private boolean isUndecided() {
            return currentDecision == null;
        }

        private boolean blocksService() {
            if (!document.required() || currentDecision == null) {
                return false;
            }
            return currentDecision.blocksServiceWhenRequired();
        }
    }
}
