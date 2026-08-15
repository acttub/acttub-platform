package com.acttub.actingapi.consent;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.auth.AuthDependencies;
import com.acttub.actingapi.consent.ConsentDtos.ConsentDocument;
import com.acttub.actingapi.consent.ConsentDtos.ConsentDocumentsResponse;
import com.acttub.actingapi.consent.ConsentDtos.ConsentEventResponse;
import com.acttub.actingapi.consent.ConsentDtos.ConsentRequest;
import com.acttub.actingapi.schema.ConsentAction;
import com.acttub.actingapi.web.ApiException;
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
    private final ConsentStore store;
    private final AuthDependencies auth;
    private final Clock clock;

    ConsentController(ConsentStore store, AuthDependencies auth, Clock clock) {
        this.store = store;
        this.auth = auth;
        this.clock = clock;
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
        return documents(store.listLatestDocuments());
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
        Map<UUID, String> actions = store.getCurrentUserConsents(user.id()).stream()
                .collect(java.util.stream.Collectors.toMap(
                        ConsentStore.UserConsentRow::documentId,
                        event -> event.action().dbValue()));
        List<ConsentStore.ConsentDocumentRow> pending = store.listLatestDocuments().stream()
                .filter(document -> document.required()
                        && !"granted".equals(actions.get(document.id())))
                .toList();
        return documents(pending);
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
        UUID documentId;
        try {
            documentId = UUID.fromString(body.documentId());
        } catch (IllegalArgumentException exception) {
            throw new ApiException(404, "consent_document_not_found");
        }
        if (store.findDocument(documentId) == null) {
            throw new ApiException(404, "consent_document_not_found");
        }
        ConsentStore.UserConsentRow event =
                store.recordConsent(
                        user.id(),
                        documentId,
                        ConsentAction.valueOf(body.action().name().toUpperCase(java.util.Locale.ROOT)),
                        clock.instant());
        return new ConsentEventResponse(
                event.id(),
                event.documentId(),
                event.action().dbValue(),
                event.occurredAt());
    }

    private static ConsentDocumentsResponse documents(
            List<ConsentStore.ConsentDocumentRow> rows) {
        return new ConsentDocumentsResponse(rows.stream()
                .map(row -> new ConsentDocument(
                        row.id(),
                        row.type().dbValue(),
                        row.version(),
                        row.title(),
                        row.body(),
                        row.required(),
                        row.publishedAt()))
                .toList());
    }
}
