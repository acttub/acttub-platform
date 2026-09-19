package com.acttub.actingapi.feature.portfolio.adapter.web;

import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.PublicCredit;
import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.PublicPhoto;
import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.PublicPortfolioResponse;
import com.acttub.actingapi.feature.portfolio.app.PortfolioService;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
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
 * 포트폴리오 공개 조회 — 캐스팅하는 사람이 받은 링크를 로그인 없이 연다. 게이트 밖이고 액세스 토큰을 보지
 * 않는다. <b>브라우저가 직접 부른다</b>(SOMA-528 결정 I-8) — 그래서 IP 별 분당 60회가 보는 사람마다 걸린다.
 * 주소를 마구 찔러 보는 것을 늦추는 장치다.
 *
 * <p>검색 엔진에 노출하지 않는다. 웹 페이지의 noindex 메타와 함께 응답에도 {@code X-Robots-Tag} 를 싣는다.
 */
@RestController
class PublicPortfolioController {
    private final PortfolioService portfolios;
    private final FixedWindowRateLimiter limiter;

    PublicPortfolioController(PortfolioService portfolios, FixedWindowRateLimiter limiter) {
        this.portfolios = portfolios;
        this.limiter = limiter;
    }

    @Operation(
            summary = "Get Public Portfolio",
            description = """
                    공유가 켜진 포트폴리오를 로그인 없이 본다. 꺼진 링크, 없는 slug, 탈퇴한 사람의 slug 는 같은 404
                    portfolio_not_found 다. 추구하는 방향·경력 구간·목표와 연습·분석은 나오지 않는다.""",
            operationId = "get_public_portfolio_v2_public_portfolios__slug__get",
            tags = "v2-portfolio")
    @ApiResponse(
            responseCode = "200",
            description = "응답 헤더 X-Robots-Tag: noindex",
            content = @Content(schema = @Schema(implementation = PublicPortfolioResponse.class)))
    @GetMapping("/v2/public/portfolios/{slug}")
    ResponseEntity<PublicPortfolioResponse> get(@PathVariable("slug") String slug, HttpServletRequest request) {
        String host = request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
        if (!limiter.allow("public-portfolio-ip:" + host, 60)) {
            throw new ApiException(429, "rate limit exceeded");
        }
        PortfolioService.PublicPortfolio view = portfolios.publicView(slug);
        return ResponseEntity.ok()
                .header("X-Robots-Tag", "noindex, nofollow")
                .body(new PublicPortfolioResponse(
                        view.name(),
                        view.photoUrl(),
                        view.gender(),
                        view.age(),
                        view.intro(),
                        view.credits().stream()
                                .map(credit -> new PublicCredit(
                                        credit.title(), credit.role(), credit.year(), credit.kind()))
                                .toList(),
                        view.photoUrls().stream().map(PublicPhoto::new).toList()));
    }
}
