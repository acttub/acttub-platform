package com.acttub.actingapi.feature.reading.adapter.web;

import com.acttub.actingapi.feature.reading.adapter.web.ReadingExampleDtos.ListResponse;
import com.acttub.actingapi.feature.reading.adapter.web.ReadingExampleDtos.StartRequest;
import com.acttub.actingapi.feature.reading.adapter.web.ReadingExampleDtos.StartedResponse;
import com.acttub.actingapi.feature.reading.app.ReadingExampleService;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 예시 대본 고르기 (reading.script 「예시 대본」). 서버에 미리 나눠 둔 예시를 보이고, 고르면 내 대본으로 복사한다. 리딩 경로라
 * 게스트도 지난다. 이름이 비슷한 {@code /v2/sample-scripts} 는 「대본 같이 만들기」다.
 */
@RestController
@RequestMapping("/v2/reading/examples")
class ReadingExampleController {
    private final ReadingExampleService examples;
    private final AccessGate auth;

    ReadingExampleController(ReadingExampleService examples, AccessGate auth) {
        this.examples = examples;
        this.auth = auth;
    }

    @Operation(
            summary = "List Reading Examples",
            description = "켜진 예시 대본을 정한 순서로. preview 는 앞 5줄까지이고 지문·장면은 speaker 가 null 이다.",
            operationId = "list_reading_examples_v2_reading_examples_get",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ListResponse.class)))
    @GetMapping
    ListResponse list(HttpServletRequest request) {
        auth.gatedUser(request);
        return ListResponse.of(examples.list());
    }

    @Operation(
            summary = "Start Reading Example",
            description = """
                    예시를 미리 나눈 그대로 내 대본(source sample, 제목은 예시 제목)으로 복사한다. 모델을 부르지 않아 script_split
                    동의·하루 나누기 한도를 보지 않는다(게스트도 된다). 새로 복사하면 201, 같은 글의 대본이 이미 있거나 같은
                    request_id 의 재전송이면 200 으로 그 대본을 준다(created false). 지운 뒤에는 다시 복사한다. 없거나 꺼진 예시
                    404 reading_example_not_found, 대본 수 한도 422 script_limit, 같은 request_id 에 다른 본문 422
                    request_fingerprint_mismatch.""",
            operationId = "start_reading_example_v2_reading_examples__example_id__start_post",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "201", description = "복사했다",
            content = @Content(schema = @Schema(implementation = StartedResponse.class)))
    @ApiResponse(responseCode = "200", description = "같은 글의 대본이 이미 있음 또는 재전송",
            content = @Content(schema = @Schema(implementation = StartedResponse.class)))
    @ApiResponse(responseCode = "422", description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping("/{example_id}/start")
    ResponseEntity<StartedResponse> start(
            @PathVariable("example_id") String exampleId, @Valid @RequestBody StartRequest body, HttpServletRequest request) {
        AuthenticatedUser user = auth.gatedUser(request);
        ReadingExampleService.Started started = examples.start(user.id(), user.guest(), body.requestId(), exampleId);
        return ResponseEntity.status(started.created() ? 201 : 200).body(new StartedResponse(started.scriptId(), started.created()));
    }
}
