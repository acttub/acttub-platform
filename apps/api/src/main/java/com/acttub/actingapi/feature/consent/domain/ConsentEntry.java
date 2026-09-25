package com.acttub.actingapi.feature.consent.domain;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 현재 판 동의 문서와 배우의 결정을 함께 보고 계산한 서비스 진입 판정.
 *
 * <p>저장하는 상태가 아니다. 현재 판에 대한 결정을 붙일 때마다 다시 계산한다.
 *
 * <p>갈래는 둘뿐이다 — 모두 결정했거나, 결정할 것이 남았거나. 필수 문서를 거절·철회한 사람을
 * 따로 가르던 셋째 갈래는 없앴다: 그 기록은 미결정과 같게 다룬다({@link ConsentDocument#decidedBy}).
 */
public record ConsentEntry(
        Status status,
        List<DocumentDecision> documents,
        List<DocumentDecision> undecidedDocuments) {

    public ConsentEntry {
        documents = List.copyOf(documents);
        undecidedDocuments = List.copyOf(undecidedDocuments);
    }

    /**
     * @param currentConsents 문서마다 이 사람의 <b>마지막</b> 행위 한 줄씩. 결정은 판 단위라, 옛 판에
     *        대한 행위는 현재 판의 식별자와 맞지 않아 저절로 빠진다.
     */
    public static ConsentEntry evaluate(
            List<ConsentDocument> latestDocuments,
            List<ConsentEvent> currentConsents) {
        Map<UUID, ConsentEvent> lastByDocument = new HashMap<>();
        for (ConsentEvent consent : currentConsents) {
            lastByDocument.put(consent.documentId(), consent);
        }

        List<DocumentDecision> documents = latestDocuments.stream()
                .map(document -> {
                    ConsentEvent last = lastByDocument.get(document.id());
                    boolean decided = last != null && document.decidedBy(last.action());
                    return new DocumentDecision(document, decided ? last : null);
                })
                .toList();
        List<DocumentDecision> undecidedDocuments = documents.stream()
                .filter(DocumentDecision::isUndecided)
                .toList();
        return new ConsentEntry(
                undecidedDocuments.isEmpty() ? Status.ALLOWED : Status.DECISION_REQUIRED,
                documents,
                undecidedDocuments);
    }

    public enum Status {
        ALLOWED,
        DECISION_REQUIRED
    }

    /** @param currentDecision 이 판에 대한 결정. 미결정이면 {@code null} */
    public record DocumentDecision(
            ConsentDocument document,
            ConsentEvent currentDecision) {

        public boolean isUndecided() {
            return currentDecision == null;
        }
    }
}
