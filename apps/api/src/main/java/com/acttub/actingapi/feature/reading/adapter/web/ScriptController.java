package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.CardResponse;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.CharacterInput;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.CharacterPatchInput;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.CharacterResponse;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.CreateRequest;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.LastSessionResponse;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.LineInput;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.LineKindInput;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.LinePatchRequest;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.LineResponse;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.LineSplitRequest;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.ListResponse;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.PatchRequest;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.SceneResponse;
import com.acttub.actingapi.feature.reading.adapter.web.ScriptDtos.ScriptResponse;
import com.acttub.actingapi.feature.reading.app.ScriptRepository.CharacterPatch;
import com.acttub.actingapi.feature.reading.app.ScriptRepository.LinePatch;
import com.acttub.actingapi.feature.reading.app.ScriptService;
import com.acttub.actingapi.feature.reading.app.ScriptViews;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.acttub.actingapi.platform.web.RequestIdHeader;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 대본 — 등록·목록·상세·수정·삭제 (reading.script). 전부 보호 기능이고 웹 게스트도 쓴다(게스트의 기능 표
 * {@code READING}: 이용약관·개인정보 수집·이용 동의 둘, AI 분석 동의는 없다).
 *
 * <p>값의 형태(필수 키·타입·값 목록·배역 자리·줄 순서)는 여기서 보고 422 배열로 답한다. 규칙(배역 없음·이름
 * 겹침·한도·지문 불일치)은 서비스가 사유 코드 하나로 답한다.
 */
@RestController
@RequestMapping("/v2/reading/scripts")
class ScriptController {
    private final ScriptService scripts;
    private final AccessGate auth;

    ScriptController(ScriptService scripts, AccessGate auth) {
        this.scripts = scripts;
        this.auth = auth;
    }

    @Operation(
            summary = "Create Script",
            description = """
                    기기가 나눈 대본(원문·배역·줄)을 한 요청으로 저장한다. 같은 request_id 에 같은 본문이 다시 오면
                    먼저 만든 대본을 200 으로 돌려주고, 다른 본문이면 422 request_fingerprint_mismatch 다. 배역 없음
                    422 no_characters, 비거나 겹치는 배역 이름 422 invalid_characters, 원문·줄 본문 100,000자
                    초과 422 script_too_long, 대본 수 회원 100·게스트 20 초과 422 script_limit.""",
            operationId = "create_script_v2_reading_scripts_post",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ScriptResponse.class)))
    @ApiResponse(
            responseCode = "200",
            description = "같은 요청의 재전송 — 먼저 만든 대본",
            content = @Content(schema = @Schema(implementation = ScriptResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping
    ResponseEntity<ScriptResponse> create(
            @Parameter(description = "본문의 request_id 와 같은 값. 실으면 같아야 하고 다르면 422 다")
            @RequestHeader(name = RequestIdHeader.NAME, required = false) String requestIdHeader,
            @Valid @RequestBody CreateRequest body,
            HttpServletRequest request) {
        AuthenticatedUser user = auth.gatedUser(request);
        RequestIdHeader.requireMatching(requestIdHeader, body.requestId());
        ScriptService.Created created = scripts.create(user.id(), user.guest(), body.requestId(), draft(body));
        return ResponseEntity.status(created.created() ? 201 : 200).body(script(created.script()));
    }

    @Operation(
            summary = "List Scripts",
            description = """
                    내 대본을 최근 고친 순으로. q 는 제목과 배역 이름에서 찾고 대사 본문은 찾지 않는다. 머리의 수
                    (전체·연습 중)는 검색과 무관하다.""",
            operationId = "list_scripts_v2_reading_scripts_get",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ListResponse.class)))
    @GetMapping
    ListResponse list(
            @Parameter(description = "제목·배역 이름 검색어") @RequestParam(name = "q", required = false) String query,
            HttpServletRequest request) {
        ScriptViews.ScriptListView list = scripts.list(auth.gatedUser(request).id(), query);
        return new ListResponse(
                list.scripts().stream().map(ScriptController::card).toList(),
                list.totalCount(),
                list.inProgressCount());
    }

    @Operation(
            summary = "Get Script",
            description = "없는 것과 남의 것은 같은 404 script_not_found 다.",
            operationId = "get_script_v2_reading_scripts__script_id__get",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ScriptResponse.class)))
    @GetMapping("/{script_id}")
    ScriptResponse get(@PathVariable("script_id") UUID scriptId, HttpServletRequest request) {
        return script(scripts.find(auth.gatedUser(request).id(), scriptId));
    }

    @Operation(
            summary = "Update Script",
            description = """
                    제목과 배역의 이름·목소리만 고친다. 줄은 받지 않는다(줄은 /lines/{line_id} 로 고친다). 이름은 앞뒤 공백을 정리하고 비어 있거나 같은
                    대본 안에서 겹치면 422 invalid_characters. voice_preset 은 키가 있을 때만 바꾸며 null 은 "자동"이다.""",
            operationId = "update_script_v2_reading_scripts__script_id__patch",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ScriptResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PatchMapping("/{script_id}")
    ScriptResponse update(
            @PathVariable("script_id") UUID scriptId,
            @Valid @RequestBody PatchRequest body,
            HttpServletRequest request) {
        AuthenticatedUser user = auth.gatedUser(request);
        if (body.title() != null && body.title().isBlank()) {
            throw ApiValidationException.valueError(
                    List.of("body", "title"), "Value error, title must not be blank", body.title());
        }
        List<CharacterPatch> patches = new ArrayList<>();
        if (body.characters() != null) {
            for (CharacterPatchInput patch : body.characters()) {
                patches.add(new CharacterPatch(
                        patch.getId(), patch.getName(), patch.isVoicePresetSet(), patch.getVoicePreset()));
            }
        }
        return script(scripts.update(user.id(), scriptId, body.title(), patches));
    }

    @Operation(
            summary = "Update Script Line",
            description = """
                    줄 하나의 종류·배역·글을 고친다(나누기가 틀린 줄을 바로잡는다). 줄 id·순서는 그대로라 회차·녹음·외운 줄의
                    연결이 남는다. 대사면 이 대본의 배역이 있어야 하고 지문·장면이면 배역이 없다 — 어기면 422 invalid_line.
                    대사가 아니게 바꾸면 배역은 저절로 빠진다. 없는 줄은 404 line_not_found, 없는·남의 대본은 404
                    script_not_found. 고친 대본 전체를 돌려준다.""",
            operationId = "update_script_line_v2_reading_scripts__script_id__lines__line_id__patch",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ScriptResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PatchMapping("/{script_id}/lines/{line_id}")
    ScriptResponse updateLine(
            @PathVariable("script_id") UUID scriptId,
            @PathVariable("line_id") UUID lineId,
            @Valid @RequestBody LinePatchRequest body,
            HttpServletRequest request) {
        AuthenticatedUser user = auth.gatedUser(request);
        String text = body.text() == null ? null : lineText("text", body.text());
        LinePatch patch = new LinePatch(body.kind() == null ? null : body.kind().name(), body.characterId(), text);
        return script(scripts.editLine(user.id(), scriptId, lineId, patch));
    }

    @Operation(
            summary = "Delete Script Line",
            description = """
                    줄 하나를 지운다(나누기가 잘못 넣은 줄). 그 줄을 구간 시작·끝·진행 위치로 가리키는 회차는 구간 안의 가까운
                    대사로 옮긴다 — 시작은 뒤 대사, 끝은 앞 대사, 진행 위치는 뒤 대사(없으면 앞 대사). 그 줄의 녹음(파일 포함)·외운
                    줄·줄 결과·말한 것은 함께 지운다. 지우면 대사가 하나도 남지 않는 회차 구간이 있으면 422 empty_range, 대본의
                    마지막 줄이면 422 invalid_line 이고 아무것도 바꾸지 않는다. 없는 줄은 404 line_not_found, 없는·남의 대본은 404
                    script_not_found. 고친 대본 전체를 돌려준다.""",
            operationId = "delete_script_line_v2_reading_scripts__script_id__lines__line_id__delete",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ScriptResponse.class)))
    @DeleteMapping("/{script_id}/lines/{line_id}")
    ScriptResponse deleteLine(
            @PathVariable("script_id") UUID scriptId,
            @PathVariable("line_id") UUID lineId,
            HttpServletRequest request) {
        return script(scripts.deleteLine(auth.gatedUser(request).id(), scriptId, lineId));
    }

    @Operation(
            summary = "Split Script Line",
            description = """
                    줄 하나를 둘로 나눈다(나누기가 한 줄로 합친 대사). 앞 글은 그 줄(id 그대로)에 남고 뒤 글은 바로 뒤에 같은
                    종류·배역의 새 줄이 되며, 뒤 줄들의 순서가 하나씩 밀린다. 회차·녹음·외운 줄은 앞 줄을 계속 가리키고, 구간이 그
                    줄로 끝나던 회차는 끝을 뒤 줄로 옮긴다. 두 글은 앞뒤 공백을 정리하고 비거나 5,000자를 넘으면 422 배열이다. 없는
                    줄은 404 line_not_found, 없는·남의 대본은 404 script_not_found. 고친 대본 전체를 돌려준다.""",
            operationId = "split_script_line_v2_reading_scripts__script_id__lines__line_id__split_post",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ScriptResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping("/{script_id}/lines/{line_id}/split")
    ScriptResponse splitLine(
            @PathVariable("script_id") UUID scriptId,
            @PathVariable("line_id") UUID lineId,
            @Valid @RequestBody LineSplitRequest body,
            HttpServletRequest request) {
        AuthenticatedUser user = auth.gatedUser(request);
        String first = lineText("first_text", body.firstText());
        String second = lineText("second_text", body.secondText());
        return script(scripts.splitLine(user.id(), scriptId, lineId, first, second));
    }

    /** 줄 글의 앞뒤 공백을 정리한다. 비거나 5,000자를 넘으면 422 배열이다. */
    private static String lineText(String field, String raw) {
        String text = raw.strip();
        if (text.isEmpty()) {
            throw ApiValidationException.valueError(
                    List.of("body", field), "Value error, " + field + " must not be blank", raw);
        }
        if (text.codePointCount(0, text.length()) > 5000) {
            throw ApiValidationException.valueError(
                    List.of("body", field), "Value error, " + field + " must be at most 5000 characters", raw);
        }
        return text;
    }

    @Operation(
            summary = "Delete Script",
            description = """
                    배역·줄·회차·녹음(파일 포함)·암기 상태와 함께 지운다. 되돌릴 수 없다. 없는 것과 남의 것은 같은
                    404 다.""",
            operationId = "delete_script_v2_reading_scripts__script_id__delete",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "204", description = "Successful Response")
    @DeleteMapping("/{script_id}")
    ResponseEntity<Void> delete(@PathVariable("script_id") UUID scriptId, HttpServletRequest request) {
        scripts.delete(auth.gatedUser(request).id(), scriptId);
        return ResponseEntity.noContent().build();
    }

    /**
     * 본문의 모양을 본다 — 빈 제목, 배열 순서와 다른 ordinal, 대사 줄의 배역 자리, 지문·장면에 실린 배역. 이름의
     * 공백 정리는 여기서 하고 비거나 겹치는 이름은 서비스가 규칙으로 거절한다.
     */
    private static ScriptDraft draft(CreateRequest body) {
        String title = body.title().strip();
        if (title.isEmpty()) {
            throw ApiValidationException.valueError(
                    List.of("body", "title"), "Value error, title must not be blank", body.title());
        }
        List<String> names = new ArrayList<>();
        for (CharacterInput character : body.characters()) {
            // 앞뒤 공백만 뗀다. 비어 있으면 서비스가 규칙(invalid_characters)으로 거절한다.
            names.add(character.name().strip());
        }
        List<ScriptDraft.Line> lines = new ArrayList<>();
        for (int index = 0; index < body.lines().size(); index++) {
            LineInput line = body.lines().get(index);
            if (line.ordinal() != index + 1) {
                throw ApiValidationException.valueError(
                        List.of("body", "lines", index, "ordinal"),
                        "Value error, ordinal must be " + (index + 1) + " (1-based array order)",
                        line.ordinal());
            }
            boolean dialogue = line.kind() == LineKindInput.dialogue;
            if (dialogue && (line.characterIndex() == null
                    || line.characterIndex() < 0 || line.characterIndex() >= body.characters().size())) {
                throw ApiValidationException.valueError(
                        List.of("body", "lines", index, "character_index"),
                        "Value error, a dialogue line must point at one of characters",
                        line.characterIndex());
            }
            if (!dialogue && line.characterIndex() != null) {
                throw ApiValidationException.valueError(
                        List.of("body", "lines", index, "character_index"),
                        "Value error, only a dialogue line has a character",
                        line.characterIndex());
            }
            lines.add(new ScriptDraft.Line(line.ordinal(), line.kind().name(), line.characterIndex(), line.text()));
        }
        return new ScriptDraft(title, body.rawText(), body.source().name(), names, lines);
    }

    private static ScriptResponse script(ScriptViews.ScriptView view) {
        return new ScriptResponse(
                view.id(),
                view.title(),
                view.source(),
                view.characters().stream().map(character -> new CharacterResponse(
                        character.id(), character.name(), character.order(), character.voicePreset(),
                        character.voice(), character.gender(), character.ageBand(), character.dialogueCount(), character.memberIds())).toList(),
                view.lines().stream().map(line -> new LineResponse(
                        line.id(), line.ordinal(), line.kind(), line.characterId(), line.text(), line.dialogueNo(),
                        line.lang(), line.speech()))
                        .toList(),
                view.scenes().stream().map(scene -> new SceneResponse(
                        scene.no(), scene.title(), scene.startLineId(), scene.endLineId(), scene.dialogueCount()))
                        .toList(),
                view.recordingCount(),
                view.openSessionId(),
                view.lastSession() == null ? null : new LastSessionResponse(
                        view.lastSession().id(),
                        view.lastSession().status(),
                        view.lastSession().myCharacterIds(),
                        view.lastSession().myCharacterNames(),
                        view.lastSession().startedAt(),
                        view.lastSession().endedAt()),
                view.createdAt(),
                view.updatedAt());
    }

    private static CardResponse card(ScriptViews.ScriptCardView card) {
        return new CardResponse(
                card.id(),
                card.title(),
                card.myCharacterNames(),
                card.dialogueCount(),
                card.recordingCount(),
                card.lastPracticedAt(),
                card.lastActivityAt(),
                card.status(),
                card.createdAt(),
                card.updatedAt());
    }
}
