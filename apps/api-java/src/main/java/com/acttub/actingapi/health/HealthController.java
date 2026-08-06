package com.acttub.actingapi.health;

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

    /** {@code acting-summary} 가 쓰는 Gemini 모델명. 기본값은 {@code acting_summary/config.py} 와 같다. */
    private final String model;
    /** Python 은 {@code bool(gateway_settings.keep_alive_url)} 로 낸다 — URL 이 설정돼 있으면 true. */
    private final boolean keepAlive;
    /** Python 은 {@code RENDER_GIT_COMMIT[:7]}, 미설정 시 {@code "unknown"}. */
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
