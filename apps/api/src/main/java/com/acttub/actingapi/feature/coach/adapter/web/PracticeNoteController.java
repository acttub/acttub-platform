package com.acttub.actingapi.feature.coach.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.feature.coach.adapter.web.ConversationDtos.NoteResponse;
import com.acttub.actingapi.feature.coach.adapter.web.NoteRatingDtos.NoteRatingRequest;
import com.acttub.actingapi.feature.coach.adapter.web.NoteRatingDtos.NoteRatingResponse;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.NoteView;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.feature.coach.app.NoteRatingService;
import com.acttub.actingapi.platform.security.AccessGate;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 회차의 연습 노트 (practice.note). 노트는 대화가 소유하지만 화면이 찾는 자리는 회차다 — 경로가 회차 밑에 있는
 * 이유이고, 그래서 {@code practice_id} 를 두고 {@code conversation_id} 를 두지 않는다.
 *
 * <p>노트 평가({@code PUT …/note/rating})도 같은 자리다 — 게이트·소유권이 노트 조회와 같아야 하기 때문이다.
 */
@RestController
@RequestMapping("/v2/practices")
class PracticeNoteController {
    private final ConversationService conversations;
    private final NoteRatingService ratings;
    private final AccessGate auth;

    PracticeNoteController(ConversationService conversations, NoteRatingService ratings, AccessGate auth) {
        this.conversations = conversations;
        this.ratings = ratings;
        this.auth = auth;
    }

    @Operation(
            summary = "Get Practice Note",
            description = """
                    그 회차의 연습 노트. 대화가 닫힐 때 한 번 만들고 다시 만들지 않는다 — 없으면 404 note_not_found
                    이고 화면은 "아직 정리 없음"을 보인다. 생성기가 낸 원문(report)이 함께 와서 옛 공개 필드를 읽던
                    화면이 그대로 쓴다. my_rating 은 이 사람이 이 노트에 남긴 평가이고 없으면 null 이다.""",
            operationId = "get_practice_note_v2_practices__practice_id__note_get",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = NoteResponse.class)))
    @GetMapping("/{practice_id}/note")
    NoteResponse note(@PathVariable("practice_id") UUID practiceId, HttpServletRequest request) {
        UUID userId = auth.gatedUser(request).id();
        NoteView note = conversations.note(userId, practiceId);
        return NoteResponse.of(note, NoteRatingResponse.of(ratings.mine(userId, note.id())));
    }

    @Operation(
            summary = "Rate Practice Note",
            description = """
                    노트에 "도움 됐어요(helpful)·아쉬웠어요(not_helpful)" 와 한 줄(선택)을 남긴다. 노트 하나에 한 행이고
                    다시 보내면 덮어쓴다 — comment 를 빼면 한 줄도 비운다. 한 줄은 앞뒤 공백을 걷은 1~100자이고 넘으면
                    422 comment_too_long 이다.

                    같은 request_id·같은 본문의 재전송은 200 같은 응답이고, 같은 id 에 다른 본문이면 422
                    request_fingerprint_mismatch 다. 없는 회차·남의 회차·노트가 아직 없는 회차는 모두 404
                    note_not_found 다(노트 조회와 같다).""",
            operationId = "rate_practice_note_v2_practices__practice_id__note_rating_put",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = NoteRatingResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PutMapping("/{practice_id}/note/rating")
    NoteRatingResponse rate(
            @PathVariable("practice_id") UUID practiceId,
            @Valid @RequestBody NoteRatingRequest body,
            HttpServletRequest request) {
        return NoteRatingResponse.of(ratings.rate(
                auth.gatedUser(request).id(), practiceId, body.requestId(), body.rating(), body.comment()));
    }
}
