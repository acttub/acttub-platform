package com.acttub.actingapi.feature.challenge.adapter.web;

import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Card;
import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Listing;
import com.acttub.actingapi.feature.challenge.app.ChallengeService;
import com.acttub.actingapi.feature.challenge.app.ChallengeService.Draft;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v2/challenges")
class ChallengeController {
    private final ChallengeService challenges;
    private final ChallengeMembers members;
    ChallengeController(ChallengeService challenges, ChallengeMembers members) { this.challenges = challenges; this.members = members; }

    @Schema(name = "ChallengeCreateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Create(@NotNull UUID requestId, @NotNull String line, @NotNull String work,
                  @Schema(nullable = true) String character, @Schema(nullable = true) String sceneNote,
                  @NotNull Integer durationDays) { }

    @PostMapping
    @Operation(summary = "Create Challenge", operationId = "create_challenge_v2_challenges_post",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "201", description = "Created", content = @Content(schema = @Schema(implementation = Card.class)))
    @ApiResponse(responseCode = "200", description = "Replay", content = @Content(schema = @Schema(implementation = Card.class)))
    ResponseEntity<Card> create(@Valid @RequestBody Create body, HttpServletRequest request) {
        UUID owner = member(request);
        Draft draft = new Draft(body.line(), body.work(), body.character(), body.sceneNote(), body.durationDays());
        var result = challenges.create(owner, body.requestId(), draft);
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(result.card());
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get Challenge", operationId = "get_challenge_v2_challenges__id__get",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    Card find(@PathVariable UUID id, HttpServletRequest request) {
        return challenges.find(member(request), id);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete Empty Challenge", operationId = "delete_challenge_v2_challenges__id__delete",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    void delete(@PathVariable UUID id, HttpServletRequest request) { challenges.delete(member(request), id); }

    @GetMapping
    @Operation(summary = "List Challenges", operationId = "list_challenges_v2_challenges_get",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    Listing list(@RequestParam(defaultValue = "popular") String tab,
            @RequestParam(name = "q", defaultValue = "") String query,
            @RequestParam(name = "cursor", required = false) String cursor, HttpServletRequest request) {
        UUID viewer = member(request);
        if (!java.util.Set.of("popular", "latest", "ended", "mine").contains(tab)) {
            throw ApiValidationException.valueError(List.of("query", "tab"), "Value error, invalid tab", tab);
        }
        var result = challenges.list(viewer, tab, query, cursor);
        return result;
    }

    private UUID member(HttpServletRequest request) { return members.member(request); }

}
