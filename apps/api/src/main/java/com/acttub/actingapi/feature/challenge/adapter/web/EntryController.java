package com.acttub.actingapi.feature.challenge.adapter.web;

import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.EntryCard;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.EntryPage;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.MyEntries;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.MyEntry;
import com.acttub.actingapi.feature.challenge.app.EntryService;
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

/** 참여작 (challenge.entry, challenge.browse). 한국어 앱 회원 전용이다. */
@RestController
@RequestMapping("/v2")
class EntryController {
    private final EntryService entries;
    private final ChallengeMembers members;
    EntryController(EntryService entries, ChallengeMembers members) { this.entries = entries; this.members = members; }

    @Schema(name = "ChallengeEntryCreateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Create(@NotNull UUID requestId, @NotNull UUID videoId,
                  @Schema(nullable = true, description = "300자(코드 포인트)까지. 앞뒤 공백을 떼고 비면 캡션 없음") String caption,
                  @NotNull @Schema(allowableValues = {"public", "private"}, description = "올리기 화면에서 명시적으로 고른다")
                  String visibility) { }

    @Schema(name = "ChallengeEntryPatchRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Patch(@Schema(nullable = true, description = "빈 문자열이면 캡션을 지운다. 바뀌면 content_version 이 오른다") String caption,
                 @Schema(nullable = true, allowableValues = {"public", "private"}) String visibility) { }

    @Schema(name = "ChallengeEntryViewRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record View(@NotNull UUID eventId) { }

    @PostMapping("/challenges/{id}/entries")
    @Operation(summary = "Create Challenge Entry", operationId = "create_entry_v2_challenges__id__entries_post",
            description = """
                    파일이 남아 있는 확정된 본인 영상으로 참여한다. 실제 길이 60초 초과 422 video_too_long, 미확정·파일 파기 영상
                    422 video_not_ready, 없는·남의 영상 404, 같은 챌린지의 같은 영상 422 duplicate_entry, 하루 네 번째 429
                    daily_entry_limit, 종료 챌린지 422 challenge_closed, review·hidden·deleted 챌린지 404. 같은 request_id·같은
                    본문의 재전송은 같은 참여작(200)이다.""",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "201", description = "Created", content = @Content(schema = @Schema(implementation = MyEntry.class)))
    @ApiResponse(responseCode = "200", description = "Replay", content = @Content(schema = @Schema(implementation = MyEntry.class)))
    ResponseEntity<MyEntry> create(@PathVariable UUID id, @Valid @RequestBody Create body, HttpServletRequest request) {
        var result = entries.create(members.member(request), id, body.requestId(), body.videoId(), body.caption(), body.visibility());
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result.entry());
    }

    @GetMapping("/challenges/{id}/entries")
    @Operation(summary = "List Challenge Entries", operationId = "list_entries_v2_challenges__id__entries_get",
            description = """
                    랭킹·피드. likes 는 첫 조회의 순서와 공동 순위를 10분 동안 굳혀 이어 주고 매 쪽에서 개인 노출 조건을 다시
                    본다. 정렬 기준이 바뀌었거나(진행 중 → 집계 중 → 확정) 10분이 지난 커서는 410 cursor_expired. latest 는
                    공개 시각 역순이고 순위가 없다. from_entry 는 피드의 시작 참여작이다.""",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    EntryPage list(@PathVariable UUID id, @RequestParam(defaultValue = "likes") String sort,
                   @RequestParam(required = false) String cursor,
                   @RequestParam(name = "from_entry", required = false) UUID fromEntry, HttpServletRequest request) {
        return entries.list(members.member(request), id, sort, cursor, fromEntry);
    }

    @GetMapping("/entries/{id}")
    @Operation(summary = "Get Challenge Entry", operationId = "get_entry_v2_entries__id__get",
            description = "공유 링크의 참여작. 본인 것이거나 개인 노출 조건을 지나야 보이고 그 밖은 404 다.",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    EntryCard find(@PathVariable UUID id, HttpServletRequest request) { return entries.find(members.member(request), id); }

    @PatchMapping("/entries/{id}")
    @Operation(summary = "Update Challenge Entry", operationId = "update_entry_v2_entries__id__patch",
            description = """
                    작성자만 캡션·공개 범위를 바꾼다(남의 것 404). 비공개 전환은 언제든 된다. 공개 전환은 진행 중 visible 챌린지의
                    정상 참여작만 된다 — 종료 422 challenge_closed, 신고 숨김 422 entry_hidden, 파일 파기 422 video_not_ready.
                    다시 공개해도 published_at 은 처음 값이다.""",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    MyEntry update(@PathVariable UUID id, @Valid @RequestBody Patch body, HttpServletRequest request) {
        return entries.update(members.member(request), id, body.caption(), body.visibility());
    }

    @DeleteMapping("/entries/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete Challenge Entry", operationId = "delete_entry_v2_entries__id__delete",
            description = "참여작만 지운다 — 영상은 보관함에 남는다. 행은 deleted 로 남고 캡션·영상 참조·반응을 지운다. 되돌리지 않는다.",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    void delete(@PathVariable UUID id, HttpServletRequest request) { entries.delete(members.member(request), id); }

    @PostMapping("/entries/{id}/views")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Record Challenge Entry View", operationId = "record_view_v2_entries__id__views_post",
            description = "3초 이상 재생된 사건 하나. 같은 event_id 는 한 번만 세고 본인 재생은 세지 않는다. 볼 수 없는 참여작은 404.",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    void view(@PathVariable UUID id, @Valid @RequestBody View body, HttpServletRequest request) {
        entries.view(members.member(request), id, body.eventId());
    }

    @GetMapping("/me/challenge-entries")
    @Operation(summary = "List My Challenge Entries", operationId = "list_my_entries_v2_me_challenge_entries_get",
            description = """
                    프로필 챌린지 기록(P03). 삭제되지 않은 내 참여작을 확인 중 → 비공개 → 공개 순으로 한 분류에만 넣어 센다.
                    visibility 로 한 분류만 볼 수 있다.""",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    MyEntries mine(@RequestParam(required = false) @Schema(allowableValues = {"public", "private", "under_review"}) String visibility,
                   @RequestParam(required = false) String cursor, HttpServletRequest request) {
        return entries.mine(members.member(request), visibility, cursor);
    }
}
