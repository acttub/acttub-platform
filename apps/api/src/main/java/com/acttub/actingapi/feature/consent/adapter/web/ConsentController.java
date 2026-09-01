package com.acttub.actingapi.feature.consent.adapter.web;

import java.util.List;
import java.util.Locale;

import com.acttub.actingapi.feature.consent.adapter.web.ConsentDtos.ConsentDocumentsResponse;
import com.acttub.actingapi.feature.consent.adapter.web.ConsentDtos.ConsentEntryDocument;
import com.acttub.actingapi.feature.consent.adapter.web.ConsentDtos.ConsentEntryResponse;
import com.acttub.actingapi.feature.consent.adapter.web.ConsentDtos.ConsentEntryStatus;
import com.acttub.actingapi.feature.consent.adapter.web.ConsentDtos.ConsentEventResponse;
import com.acttub.actingapi.feature.consent.adapter.web.ConsentDtos.ConsentRequest;
import com.acttub.actingapi.feature.consent.adapter.web.ConsentDtos.RequiredConsentDeclineError;
import com.acttub.actingapi.feature.consent.app.ConsentService;
import com.acttub.actingapi.feature.consent.domain.ConsentDocument;
import com.acttub.actingapi.feature.consent.domain.ConsentEntry;
import com.acttub.actingapi.feature.consent.domain.ConsentEvent;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.schema.ConsentAction;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v2/consents")
class ConsentController {
    private final ConsentService consents;
    private final AccessGate auth;

    ConsentController(ConsentService consents, AccessGate auth) {
        this.consents = consents;
        this.auth = auth;
    }

    @Operation(
            summary = "List Documents",
            operationId = "list_documents_v2_consents_documents_get",
            tags = "v2-consents")
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ConsentDocumentsResponse.class)))
    @GetMapping("/documents")
    ConsentDocumentsResponse listDocuments() {
        return documents(consents.latestDocuments());
    }

    @Operation(
            summary = "List Pending Documents",
            operationId = "list_pending_documents_v2_consents_pending_get",
            tags = "v2-consents",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ConsentDocumentsResponse.class)))
    @GetMapping("/pending")
    ConsentDocumentsResponse listPendingDocuments(HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        return documents(consents.pendingDocuments(user.id()));
    }

    @Operation(
            summary = "Get Consent Entry",
            operationId = "get_consent_entry_v2_consents_entry_get",
            tags = "v2-consents",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ConsentEntryResponse.class)))
    @GetMapping("/entry")
    ConsentEntryResponse getEntry(HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        return entry(consents.entryFor(user.id()));
    }

    @Operation(
            summary = "Record Consent",
            operationId = "record_consent_v2_consents_post",
            tags = "v2-consents",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "201",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = ConsentEventResponse.class))),
        @ApiResponse(
                responseCode = "409",
                description = "Required consent cannot be declined",
                content = @Content(schema = @Schema(implementation = RequiredConsentDeclineError.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    ConsentEventResponse recordConsent(
            @Valid @RequestBody ConsentRequest body,
            HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        // 받은 이름을 DB 값으로 옮기는 자리는 여기다 — 열거형이 배관(JPA)을 끌고 있어
        // 도메인으로 들일 수 없고, 요청의 어휘를 저장 값으로 옮기는 것은 web 의 일이다.
        // Jackson 이 먼저 걸러 주므로 이 변환은 실패하지 않는다.
        String action = ConsentAction
                .valueOf(body.action().name().toUpperCase(Locale.ROOT))
                .dbValue();
        ConsentEvent event = consents.record(user.id(), body.documentId(), action);
        return new ConsentEventResponse(
                event.id(),
                event.documentId(),
                event.action(),
                event.occurredAt());
    }

    private static ConsentDocumentsResponse documents(List<ConsentDocument> rows) {
        return new ConsentDocumentsResponse(rows.stream()
                .map(row -> new ConsentDtos.ConsentDocument(
                        row.id(),
                        row.type(),
                        row.version(),
                        row.title(),
                        row.body(),
                        row.required(),
                        row.publishedAt()))
                .toList());
    }

    private static ConsentEntryResponse entry(ConsentEntry entry) {
        ConsentEntryStatus status = switch (entry.status()) {
            case ALLOWED -> ConsentEntryStatus.allowed;
            case DECISION_REQUIRED -> ConsentEntryStatus.decision_required;
            case BLOCKED -> ConsentEntryStatus.blocked;
        };
        return new ConsentEntryResponse(
                status,
                entry.documents().stream().map(ConsentController::entryDocument).toList(),
                entry.undecidedDocuments().stream()
                        .map(ConsentController::entryDocument)
                        .toList());
    }

    private static ConsentEntryDocument entryDocument(ConsentEntry.DocumentDecision row) {
        ConsentDocument document = row.document();
        String currentDecision = row.currentDecision() == null
                ? null
                : row.currentDecision().action();
        return new ConsentEntryDocument(
                document.id(),
                document.type(),
                document.version(),
                document.title(),
                document.body(),
                document.required(),
                document.publishedAt(),
                currentDecision);
    }
}
