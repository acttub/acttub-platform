package com.acttub.actingapi.feature.consent.app;

import java.time.Clock;
import java.time.Instant;
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
    private final ReconsentSchedule schedule;

    public ConsentService(
            ConsentRepository consents, ConsentNoticeSource notices, Clock clock, ReconsentSchedule schedule) {
        this.consents = consents;
        this.notices = notices;
        this.clock = clock;
        this.schedule = schedule;
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
        return pendingDocuments(userId, false);
    }

    /** 게스트에게는 선택 문서를 묻지 않는다 — 선택 문서는 회원에게만 묻는다. */
    public List<ConsentDocument> pendingDocuments(UUID userId, boolean guest) {
        return entryFor(userId, guest).undecidedDocuments().stream()
                .map(ConsentEntry.DocumentDecision::document)
                .toList();
    }

    /**
     * 현재 판과 결정을 함께 읽어 서비스 진입 판정을 계산한다.
     *
     * <p>게스트의 현황에는 필수 문서만 있다. 웹은 이 목록의 {@code privacy} 행의 결정 하나로 계측을 켠다 —
     * 그 값은 <b>현재 판</b>에 대한 결정이다.
     */
    public ConsentEntry entryFor(UUID userId, boolean guest) {
        List<ConsentDocument> documents = consents.listLatestDocuments();
        List<ConsentEvent> events = consents.currentConsentsOf(userId);
        return ConsentEntry.evaluate(
                deferReconsent(guest ? documents.stream().filter(ConsentDocument::required).toList() : documents, events),
                events);
    }

    /**
     * 재동의 시작 시각({@code reconsentFrom}) 전에는, 그 종류에 이미 동의(결정)한 회원에게 새 판 대신
     * <b>그 회원이 결정한 가장 최근 판</b>을 현황에 올린다 — 재동의를 묻지 않고 동의 상태 화면에도 옛 판의
     * 결정이 그대로 보인다. 그 종류에 결정이 없는 사람(새 가입 전 등)과 새 판에 이미 결정한 사람은 그대로다.
     * 시각이 지나면 이 치환이 저절로 사라져 기존 흐름대로 재동의가 뜬다.
     */
    private List<ConsentDocument> deferReconsent(List<ConsentDocument> documents, List<ConsentEvent> events) {
        Instant now = clock.instant();
        Map<UUID, ConsentDocument> known = new java.util.HashMap<>();
        List<ConsentDocument> result = new ArrayList<>();
        for (ConsentDocument document : documents) {
            Instant from = schedule.reconsentFrom(document.type(), document.version());
            if (from == null || !now.isBefore(from)
                    || events.stream().anyMatch(event -> event.documentId().equals(document.id()))) {
                result.add(document);
                continue;
            }
            ConsentDocument previous = null;
            Instant previousAt = null;
            for (ConsentEvent event : events) {
                ConsentDocument other = known.computeIfAbsent(event.documentId(), consents::findDocument);
                if (other == null || !other.type().equals(document.type()) || other.id().equals(document.id())
                        || !other.decidedBy(event.action())) {
                    continue;
                }
                if (previousAt == null || event.occurredAt().isAfter(previousAt)) {
                    previous = other;
                    previousAt = event.occurredAt();
                }
            }
            result.add(previous != null ? previous : document);
        }
        return result;
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
    public List<Document> undecidedAmong(UUID userId, Set<String> documentTypes) {
        return undecidedFor(userId).stream()
                .filter(document -> documentTypes.contains(document.type()))
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
     *
     * <p>게스트의 결정에는 규칙이 둘 더 있다 (account.guest).
     *
     * <ul>
     *   <li>선택 문서는 회원에게만 묻는다 — 게스트가 보내면 403 {@code member_only}.</li>
     *   <li>게스트의 <b>첫</b> 동의에는 "만 14세 이상이에요" 확인이 실려야 한다. 게스트는 생년월일을 내지
     *       않으므로 이것이 만 14세 미만을 거르는 유일한 장치다. 확인한 시각을 {@code users} 행에 남기고,
     *       그 뒤로는 다시 묻지 않는다.</li>
     * </ul>
     */
    public Recorded record(
            UUID userId, String rawDocumentId, String action, boolean guest, boolean ageConfirmed) {
        Map<UUID, ConsentDocument> current = consents.listLatestDocuments().stream()
                .collect(Collectors.toMap(ConsentDocument::id, Function.identity()));
        ConsentDocument document = currentDocument(rawDocumentId, current);
        if (guest && !document.required()) {
            throw new ApiException(403, "member_only");
        }
        requireAllowed(document, action);
        if (guest && !consents.ageConfirmed(userId)) {
            if (!ageConfirmed) {
                throw new ApiException(422, "age_confirmation_required");
            }
            consents.confirmAge(userId, clock.instant());
        }
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
