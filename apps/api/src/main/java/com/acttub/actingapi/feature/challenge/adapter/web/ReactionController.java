package com.acttub.actingapi.feature.challenge.adapter.web;

import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.BlockList;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.Blocked;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.Comment;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.CommentPage;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.Liked;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.Saved;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.SavedEntries;
import com.acttub.actingapi.feature.challenge.app.ReactionService;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.Receipt;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** 좋아요·저장·댓글·차단·신고 (challenge.react, challenge.block, challenge.report). 한국어 앱 회원 전용이다. */
@RestController
@RequestMapping("/v2")
class ReactionController {
    private final ReactionService reactions;
    private final ChallengeMembers members;
    ReactionController(ReactionService reactions, ChallengeMembers members) { this.reactions = reactions; this.members = members; }

    @Schema(name = "EntryCommentCreateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CommentBody(@NotNull UUID requestId,
                       @NotNull @Schema(description = "앞뒤 공백을 걷고 1~500자(코드 포인트)") String body) { }

    @Schema(name = "ChallengeReportRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ReportBody(@NotNull UUID requestId,
                      @NotNull @Schema(allowableValues = {"entry", "comment", "challenge"}) String targetType,
                      @NotNull UUID targetId,
                      @NotNull @Schema(allowableValues = {"copyright", "inappropriate", "spam", "duplicate", "other"}) String reason,
                      @Schema(nullable = true, description = "200자(코드 포인트)까지") String note) { }

    private static final String REACTION = """
            보는 사람에게 보이는 참여작에만 된다 — 비공개·삭제·숨김·review·hidden 챌린지·차단 관계는 404. 켜기·끄기는 멱등이다.""";

    @PutMapping("/entries/{id}/like")
    @Operation(summary = "Like Entry", operationId = "like_entry_v2_entries__id__like_put", description = REACTION
            + " 자기 참여작은 422 self_like. 종료 뒤에도 되지만 저장된 최종 순위는 바뀌지 않는다.",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    Liked like(@PathVariable UUID id, HttpServletRequest request) { return reactions.like(members.member(request), id, true); }

    @DeleteMapping("/entries/{id}/like")
    @Operation(summary = "Unlike Entry", operationId = "unlike_entry_v2_entries__id__like_delete", description = REACTION,
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    Liked unlike(@PathVariable UUID id, HttpServletRequest request) { return reactions.like(members.member(request), id, false); }

    @PutMapping("/entries/{id}/save")
    @Operation(summary = "Save Entry", operationId = "save_entry_v2_entries__id__save_put", description = REACTION
            + " 자기 참여작은 422 self_save. 랭킹·알림에 반영하지 않는다.",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    Saved save(@PathVariable UUID id, HttpServletRequest request) { return reactions.save(members.member(request), id, true); }

    @DeleteMapping("/entries/{id}/save")
    @Operation(summary = "Unsave Entry", operationId = "unsave_entry_v2_entries__id__save_delete", description = REACTION,
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    Saved unsave(@PathVariable UUID id, HttpServletRequest request) { return reactions.save(members.member(request), id, false); }

    @GetMapping("/me/saved-entries")
    @Operation(summary = "List Saved Entries", operationId = "list_saved_entries_v2_me_saved_entries_get",
            description = "저장순 20개씩. 비공개·숨김·차단으로 지금 볼 수 없는 것은 빠지고 행은 남는다(다시 보이면 돌아온다).",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    SavedEntries saved(@RequestParam(required = false) String cursor, HttpServletRequest request) {
        return reactions.saved(members.member(request), cursor);
    }

    @GetMapping("/entries/{id}/comments")
    @Operation(summary = "List Entry Comments", operationId = "list_comments_v2_entries__id__comments_get",
            description = """
                    최신순 20개씩. 차단 관계의 댓글과 숨겨진 남의 댓글은 빠지고, 신고로 숨겨진 내 댓글은 status hidden 으로
                    나에게만 온다. 부모 참여작이 보이지 않으면 404.""",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    CommentPage comments(@PathVariable UUID id, @RequestParam(required = false) String cursor, HttpServletRequest request) {
        return reactions.comments(members.member(request), id, cursor);
    }

    @PostMapping("/entries/{id}/comments")
    @Operation(summary = "Create Entry Comment", operationId = "create_comment_v2_entries__id__comments_post",
            description = "자기 참여작에도 쓸 수 있다. 하루 100개(429 daily_comment_limit). 같은 request_id·같은 본문은 같은 댓글(200).",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "201", description = "Created", content = @Content(schema = @Schema(implementation = Comment.class)))
    @ApiResponse(responseCode = "200", description = "Replay", content = @Content(schema = @Schema(implementation = Comment.class)))
    ResponseEntity<Comment> comment(@PathVariable UUID id, @Valid @RequestBody CommentBody body, HttpServletRequest request) {
        var result = reactions.comment(members.member(request), id, body.requestId(), body.body());
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result.comment());
    }

    @DeleteMapping("/comments/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete Entry Comment", operationId = "delete_comment_v2_comments__id__delete",
            description = "본인 댓글만(남의 것 404). 본문을 파기하고 목록에서 뺀다.",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    void deleteComment(@PathVariable UUID id, HttpServletRequest request) { reactions.deleteComment(members.member(request), id); }

    @PutMapping("/me/blocks/{user_id}")
    @Operation(summary = "Block User", operationId = "block_user_v2_me_blocks__user_id__put",
            description = "상대에게 알리지 않는다. 자기 자신 422 self_block, 없는 회원 404. 멱등이다.",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    Blocked block(@PathVariable("user_id") UUID userId, HttpServletRequest request) { return reactions.block(members.member(request), userId, true); }

    @DeleteMapping("/me/blocks/{user_id}")
    @Operation(summary = "Unblock User", operationId = "unblock_user_v2_me_blocks__user_id__delete",
            description = "멱등이다. 없는 차단을 풀어도 200.",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    Blocked unblock(@PathVariable("user_id") UUID userId, HttpServletRequest request) { return reactions.block(members.member(request), userId, false); }

    @GetMapping("/me/blocks")
    @Operation(summary = "List Blocked Users", operationId = "list_blocks_v2_me_blocks_get",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    BlockList blocks(HttpServletRequest request) { return reactions.blocks(members.member(request)); }

    @PostMapping("/reports")
    @Operation(summary = "Report Challenge Content", operationId = "create_challenge_report_v2_reports_post",
            description = """
                    참여작·댓글·챌린지 신고. 지금 볼 수 있는 대상만(아니면 404) 되고 본인 것은 422 self_report, 하루 21번째는 429
                    daily_report_limit. 참여작·댓글은 접수와 함께 숨겨지고, 챌린지는 서로 다른 세 사람의 처리 전 신고가 모이면
                    검토로 넘어간다. 같은 대상의 재신고는 먼저 낸 신고(200)다.""",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "201", description = "Created", content = @Content(schema = @Schema(implementation = Receipt.class)))
    @ApiResponse(responseCode = "200", description = "Replay", content = @Content(schema = @Schema(implementation = Receipt.class)))
    ResponseEntity<Receipt> report(@Valid @RequestBody ReportBody body, HttpServletRequest request) {
        var result = reactions.report(members.member(request), body.requestId(), body.targetType(), body.targetId(), body.reason(),
                body.note());
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result.receipt());
    }
}
