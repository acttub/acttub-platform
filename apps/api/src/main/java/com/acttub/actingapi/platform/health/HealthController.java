package com.acttub.actingapi.platform.health;

import java.util.List;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import org.springframework.http.MediaType;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    /** 영상 분석이 쓰는 Gemini 모델명. 기본값은 이관 전 파이썬 구현과 같게 두었다. */
    private final String model;
    /** URL 이 설정돼 있으면 true — 파이썬이 {@code bool(keep_alive_url)} 로 내던 값과 같다. */
    private final boolean keepAlive;
    /** {@code RENDER_GIT_COMMIT} 의 앞 7자, 미설정 시 {@code "unknown"}. */
    private final String commit;

    public HealthController(
            @Value("${GEMINI_MODEL:gemini-2.5-flash}") String model,
            @Value("${KEEP_ALIVE_URL:}") String keepAliveUrl,
            @Value("${RENDER_GIT_COMMIT:unknown}") String renderGitCommit) {
        this.model = model;
        this.keepAlive = !keepAliveUrl.isBlank();
        this.commit = renderGitCommit.length() > 7 ? renderGitCommit.substring(0, 7) : renderGitCommit;
    }

    // summary·operationId·description·미디어타입을 기존 spec 과 글자까지 맞춘다.
    // FastAPI 가 낸 것: summary "Health", operationId "health_health_get",
    // 200 description "Successful Response", content "application/json".
    @Operation(summary = "Health", operationId = "health_health_get")
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE,
                    schema = @Schema(implementation = HealthResponse.class)))
    @GetMapping(value = "/health", produces = MediaType.APPLICATION_JSON_VALUE)
    public HealthResponse health() {
        return new HealthResponse("ok", List.of("summary", "coach", "report"), model, keepAlive, commit);
    }
}
