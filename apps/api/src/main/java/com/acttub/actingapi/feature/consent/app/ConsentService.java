package com.acttub.actingapi.feature.consent.app;

import java.time.Clock;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import com.acttub.actingapi.feature.auth.app.AcceptedConsent;
import com.acttub.actingapi.feature.auth.app.PendingConsent;
import com.acttub.actingapi.feature.auth.app.PendingConsentDocuments;
import com.acttub.actingapi.feature.auth.app.SignupDecision;
import com.acttub.actingapi.feature.consent.domain.ConsentDocument;
import com.acttub.actingapi.feature.consent.domain.ConsentEntry;
import com.acttub.actingapi.feature.consent.domain.ConsentEvent;
import com.acttub.actingapi.feature.consent.domain.ConsentNotice;
import com.acttub.actingapi.platform.security.PendingConsentGate;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.stereotype.Service;

/**
 * 동의 문서 조회와 기록의 규칙.
 *
 * <p>문서와 결정을 함께 해석하는 일은 전부 여기서 한다 — 그래서 그것을 묻는 바깥 포트 둘
 * (배관의 {@link PendingConsentGate}, 로그인·가입의 {@link PendingConsentDocuments})도 위임만 하는
 * 어댑터 없이 직접 구현한다 (ADR-017). 간선은 {@code consent} → {@code auth} 한 방향이다.
 */
@Service
public class ConsentService implements PendingConsentGate, PendingConsentDocuments {
    private final ConsentRepository consents;
    private final ConsentNoticeSource notices;
    private final Clock clock;

    public ConsentService(ConsentRepository consents, ConsentNoticeSource notices, Clock clock) {
        this.consents = consents;
        this.notices = notices;
        this.clock = clock;
    }

    /** 종류마다 현재 판 하나씩. 약관 · 수집·이용 동의 · AI 분석 · 탈퇴 후 보관 순이다. */
    public List<ConsentDocument> latestDocuments() {
        return consents.listLatestDocuments();
    }

    /** 동의 대상이 아닌 고지 문서(개인정보 처리방침). 공개 페이지가 동의 문서와 함께 싣는다. */
    public List<ConsentNotice> notices() {
        return notices.notices();
    }

    /** 현재 판 가운데 이 사람이 아직 결정하지 않은 문서. 선택 문서도 센다. */
    public List<ConsentDocument> pendingDocuments(UUID userId) {
        return entryFor(userId).undecidedDocuments().stream()
                .map(ConsentEntry.DocumentDecision::document)
                .toList();
    }

    /** 현재 판과 결정을 함께 읽어 서비스 진입 판정을 계산한다. */
    public ConsentEntry entryFor(UUID userId) {
        return ConsentEntry.evaluate(
                consents.listLatestDocuments(),
                consents.currentConsentsOf(userId));
    }

    @Override
    public List<Document> undecidedFor(UUID userId) {
        return pendingDocuments(userId).stream()
                .map(document -> new Document(
                        document.id(),
                        document.type(),
                        document.version(),
                        document.title(),
                        document.body(),
                        document.required(),
                        document.publishedAt()))
                .toList();
    }

    @Override
    public List<PendingConsent> pendingFor(UUID userId) {
        return pendingDocuments(userId).stream().map(ConsentService::pending).toList();
    }

    @Override
    public List<PendingConsent> currentDocuments() {
        return latestDocuments().stream().map(ConsentService::pending).toList();
    }

    /**
     * 가입 제출의 결정 묶음을 확인한다. 현재 판 <b>모든</b> 문서의 결정이 담겨 있어야 한다 —
     * 선택 문서도 빠지면 안 된다. 그래야 가입한 순간 미결정이 하나도 없다.
     */
    @Override
    public List<AcceptedConsent> acceptSignupDecisions(List<SignupDecision> decisions) {
        Map<UUID, ConsentDocument> current = consents.listLatestDocuments().stream()
                .collect(Collectors.toMap(ConsentDocument::id, Function.identity()));
        List<AcceptedConsent> accepted = new ArrayList<>();
        Set<UUID> decided = new HashSet<>();
        for (SignupDecision decision : decisions) {
            ConsentDocument document = currentDocument(decision.documentId(), current);
            requireAllowed(document, decision.action());
            if (decided.add(document.id())) {
                accepted.add(new AcceptedConsent(document.id(), decision.action()));
            }
        }
        if (!decided.containsAll(current.keySet())) {
            throw new ApiException(422, "consent_decisions_incomplete");
        }
        return accepted;
    }

    /**
     * 문서 하나에 대한 결정을 쌓는다. 덮어쓰지 않는다 — 지금 결정은 그 판의 마지막 한 줄이다.
     *
     * <p>지금 결정과 같은 결정이 다시 오면 <b>행을 늘리지 않고</b> 이미 있는 행을 돌려준다. 여러
     * 문서를 차례로 보내다 끊긴 앱이 처음부터 다시 보내도 증빙이 부풀지 않는다.
     */
    public Recorded record(UUID userId, String rawDocumentId, String action) {
        Map<UUID, ConsentDocument> current = consents.listLatestDocuments().stream()
                .collect(Collectors.toMap(ConsentDocument::id, Function.identity()));
        ConsentDocument document = currentDocument(rawDocumentId, current);
        requireAllowed(document, action);
        ConsentEvent last = consents.currentConsentsOf(userId).stream()
                .filter(consent -> consent.documentId().equals(document.id()))
                .findFirst()
                .orElse(null);
        if (last != null && last.action().equals(action)) {
            return new Recorded(last, false);
        }
        return new Recorded(consents.record(userId, document.id(), action, clock.instant()), true);
    }

    /**
     * 가리키는 문서가 없으면 404, 있는데 현재 판이 아니면 409 다. 식별자가 UUID 형태가 아닌 것도
     * <b>같은 404</b> 로 답한다 — 형태만으로 실재 여부를 알려주지 않는다.
     */
    private ConsentDocument currentDocument(String rawDocumentId, Map<UUID, ConsentDocument> current) {
        UUID documentId;
        try {
            documentId = UUID.fromString(rawDocumentId);
        } catch (IllegalArgumentException notAUuid) {
            throw new ApiException(404, "consent_document_not_found", notAUuid);
        }
        ConsentDocument document = current.get(documentId);
        if (document != null) {
            return document;
        }
        if (consents.findDocument(documentId) == null) {
            throw new ApiException(404, "consent_document_not_found");
        }
        throw new ApiException(409, "consent_document_outdated");
    }

    /** 필수 동의를 거두는 길은 탈퇴뿐이다. */
    private static void requireAllowed(ConsentDocument document, String action) {
        if (document.required() && "declined".equals(action)) {
            throw new ApiException(422, "required_consent_cannot_be_declined");
        }
    }

    private static PendingConsent pending(ConsentDocument document) {
        return new PendingConsent(
                document.id(),
                document.type(),
                document.version(),
                document.title(),
                document.body(),
                document.required(),
                document.publishedAt());
    }

    /** @param created 새 행을 쌓았는가. 같은 결정의 재전송이면 {@code false} */
    public record Recorded(ConsentEvent event, boolean created) {
    }
}
