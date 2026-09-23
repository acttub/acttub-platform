package com.acttub.actingapi.feature.coach.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.feature.coach.adapter.web.ConversationDtos.NoteResponse;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.platform.security.AccessGate;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 회차의 연습 노트 (practice.note). 노트는 대화가 소유하지만 화면이 찾는 자리는 회차다 — 경로가 회차 밑에 있는
 * 이유이고, 그래서 {@code practice_id} 를 두고 {@code conversation_id} 를 두지 않는다.
 */
@RestController
@RequestMapping("/v2/practices")
class PracticeNoteController {
    private final ConversationService conversations;
    private final AccessGate auth;

    PracticeNoteController(ConversationService conversations, AccessGate auth) {
        this.conversations = conversations;
        this.auth = auth;
    }

    @Operation(
            summary = "Get Practice Note",
            description = """
                    그 회차의 연습 노트. 대화가 닫힐 때 한 번 만들고 다시 만들지 않는다 — 없으면 404 note_not_found
                    이고 화면은 "아직 정리 없음"을 보인다. 생성기가 낸 원문(report)이 함께 와서 옛 공개 필드를 읽던
                    화면이 그대로 쓴다.""",
            operationId = "get_practice_note_v2_practices__practice_id__note_get",
            tags = "v2-practices",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = NoteResponse.class)))
    @GetMapping("/{practice_id}/note")
    NoteResponse note(@PathVariable("practice_id") UUID practiceId, HttpServletRequest request) {
        return NoteResponse.of(conversations.note(auth.gatedUser(request).id(), practiceId));
    }
}
