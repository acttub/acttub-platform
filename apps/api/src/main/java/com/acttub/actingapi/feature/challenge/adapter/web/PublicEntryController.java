package com.acttub.actingapi.feature.challenge.adapter.web;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.EntryService;
import com.acttub.actingapi.platform.security.ClientAddress;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * 참여작 공유 링크의 공개 조회(challenge.share) — 앱이 공유하는 {@code <SITE_URL>/e/<id>} 를 메신저가 미리보기로
 * 펼칠 때 웹 서버가 부른다. 게이트 밖이고 액세스 토큰을 보지 않는다. 웹 서버가 방문자의 {@code X-Forwarded-For}
 * 를 넘기므로 IP 별 분당 60회가 방문자(메신저의 수집기)마다 걸린다.
 *
 * <p><b>작성자의 이름·사진은 싣지 않는다</b> — 링크를 받은 사람이 로그인 없이 보는 것은 작품·대사·장면뿐이다.
 * 검색 엔진에 노출하지 않는다. 웹 페이지의 noindex 메타와 함께 응답에도 {@code X-Robots-Tag} 를 싣는다.
 */
@RestController
class PublicEntryController {
    private final EntryService entries;
    private final FixedWindowRateLimiter limiter;
    private final ClientAddress addresses;

    PublicEntryController(EntryService entries, FixedWindowRateLimiter limiter, ClientAddress addresses) {
        this.entries = entries;
        this.limiter = limiter;
        this.addresses = addresses;
    }

    @Schema(name = "PublicChallengeEntry", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PublicEntryResponse(
            @Schema(requiredMode = REQUIRED) String work,
            @Schema(requiredMode = REQUIRED) String line,
            @Schema(requiredMode = REQUIRED, nullable = true) String character,
            @Schema(requiredMode = REQUIRED, nullable = true,
                    description = "장면 이미지. 아직 만들지 않아 언제나 null 이다 — 웹은 서비스 공통 OG 이미지로 대신한다")
            String posterUrl) { }

    @Operation(
            summary = "Get Public Challenge Entry",
            description = """
                    공유 링크 미리보기용으로 참여작의 챌린지 작품·대사·배역을 로그인 없이 본다. 공개 조건(공개·보이는 상태·
                    활성 작성자·파일이 남은 영상·보이는 챌린지)을 벗어난 참여작과 없는 id 는 같은 404 entry_not_found 다.
                    작성자의 이름·사진은 나오지 않는다.""",
            operationId = "get_public_entry_v2_public_entries__id__get",
            tags = "v2-challenges")
    @ApiResponse(
            responseCode = "200",
            description = "응답 헤더 X-Robots-Tag: noindex",
            content = @Content(schema = @Schema(implementation = PublicEntryResponse.class)))
    @GetMapping("/v2/public/entries/{id}")
    ResponseEntity<PublicEntryResponse> get(@PathVariable("id") UUID id, HttpServletRequest request) {
        if (!limiter.allow("public-entry-ip:" + addresses.of(request), 60)) {
            throw new ApiException(429, "rate limit exceeded");
        }
        var entry = entries.publicView(id);
        return ResponseEntity.ok()
                .header("X-Robots-Tag", "noindex, nofollow")
                .body(new PublicEntryResponse(entry.work(), entry.line(), entry.character(), null));
    }
}
