package com.acttub.actingapi.feature.portfolio.adapter.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.CreditPatch;
import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.CreditRequest;
import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.CreditResponse;
import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.IntroRequest;
import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.OrderRequest;
import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.PhotoResponse;
import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.PhotoUploadRequest;
import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.PhotoUploadResponse;
import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.PortfolioResponse;
import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.ShareRequest;
import com.acttub.actingapi.feature.portfolio.adapter.web.PortfolioDtos.ShareResponse;
import com.acttub.actingapi.feature.portfolio.app.PortfolioService;
import com.acttub.actingapi.feature.portfolio.domain.CreditRules;
import com.acttub.actingapi.feature.portfolio.domain.Portfolio;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 내 포트폴리오. 전부 보호 기능이고 <b>회원만</b> 쓴다 — 게스트에게는 포트폴리오가 없어 403
 * {@code member_only} 다(게스트의 기능 표에 이 경로가 없다). 항목마다 따로 저장한다.
 *
 * <p>값의 형태(길이·연도 범위)는 여기서 보고 422 배열로 답한다. 값 목록({@code kind})과 타입은 Jackson 이
 * 같은 모양으로 거른다.
 */
@RestController
@RequestMapping("/v2/portfolio")
class PortfolioController {
    private final PortfolioService portfolios;
    private final AccessGate auth;

    PortfolioController(PortfolioService portfolios, AccessGate auth) {
        this.portfolios = portfolios;
        this.auth = auth;
    }

    @Operation(
            summary = "Get Portfolio",
            description = "한 번도 편집하지 않았어도 빈 모양으로 200 이다. 행은 처음 저장할 때 생긴다. 배열은 저장된 순서다.",
            operationId = "get_portfolio_v2_portfolio_get",
            tags = "v2-portfolio",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = PortfolioResponse.class)))
    @GetMapping
    PortfolioResponse get(HttpServletRequest request) {
        return portfolio(portfolios.find(auth.gatedUser(request).id()));
    }

    @Operation(
            summary = "Save Intro",
            description = "소개글을 저장한다. 2,000자까지이고 null 이나 빈 글이면 지운다.",
            operationId = "save_intro_v2_portfolio_intro_put",
            tags = "v2-portfolio",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "포트폴리오 본문",
            content = @Content(schema = @Schema(implementation = PortfolioResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PutMapping("/intro")
    PortfolioResponse saveIntro(@Valid @RequestBody IntroRequest body, HttpServletRequest request) {
        var user = auth.gatedUser(request);
        if (body.intro() != null && CreditRules.length(body.intro()) > CreditRules.INTRO_MAX) {
            throw tooLong("intro", body.intro(), CreditRules.INTRO_MAX);
        }
        return portfolio(portfolios.saveIntro(user.id(), body.intro()));
    }

    @Operation(
            summary = "Add Credit",
            description = "경력을 맨 끝에 붙인다. 50개까지다.",
            operationId = "add_credit_v2_portfolio_credits_post",
            tags = "v2-portfolio",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = CreditResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping("/credits")
    ResponseEntity<CreditResponse> addCredit(@Valid @RequestBody CreditRequest body, HttpServletRequest request) {
        var user = auth.gatedUser(request);
        requireText("title", body.title());
        requireText("role", body.role());
        requireYear(body.year());
        return ResponseEntity.status(201).body(credit(portfolios.addCredit(
                user.id(), body.title(), body.role(), body.year(), body.kind().name())));
    }

    @Operation(
            summary = "Update Credit",
            description = "보낸 항목만 바꾼다.",
            operationId = "update_credit_v2_portfolio_credits__credit_id__patch",
            tags = "v2-portfolio",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "경력 하나",
            content = @Content(schema = @Schema(implementation = CreditResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PatchMapping("/credits/{credit_id}")
    CreditResponse updateCredit(
            @PathVariable("credit_id") UUID creditId,
            @Valid @RequestBody CreditPatch body,
            HttpServletRequest request) {
        var user = auth.gatedUser(request);
        if (body.title() != null) {
            requireText("title", body.title());
        }
        if (body.role() != null) {
            requireText("role", body.role());
        }
        if (body.year() != null) {
            requireYear(body.year());
        }
        return credit(portfolios.updateCredit(
                user.id(), creditId, body.title(), body.role(), body.year(),
                body.kind() == null ? null : body.kind().name()));
    }

    @Operation(
            summary = "Delete Credit",
            description = "이미 지운 것을 다시 지우면 404 다. 없는 것과 남의 것을 구분하지 않는다.",
            operationId = "delete_credit_v2_portfolio_credits__credit_id__delete",
            tags = "v2-portfolio",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "204", description = "Successful Response")
    @DeleteMapping("/credits/{credit_id}")
    ResponseEntity<Void> deleteCredit(@PathVariable("credit_id") UUID creditId, HttpServletRequest request) {
        portfolios.deleteCredit(auth.gatedUser(request).id(), creditId);
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Order Credits",
            description = "지금 있는 경력 id 를 원하는 순서로 전부 보낸다. 지금 목록과 다르면 422 order_mismatch.",
            operationId = "order_credits_v2_portfolio_credits_order_put",
            tags = "v2-portfolio",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "포트폴리오 본문",
            content = @Content(schema = @Schema(implementation = PortfolioResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PutMapping("/credits/order")
    PortfolioResponse orderCredits(@Valid @RequestBody OrderRequest body, HttpServletRequest request) {
        return portfolio(portfolios.orderCredits(auth.gatedUser(request).id(), body.ids()));
    }

    @Operation(
            summary = "Begin Portfolio Photo Upload",
            description = """
                    포트폴리오 사진을 올릴 주소를 받는다. 10장까지, 이미지 파일만. 프로필 사진과 같이 앱이 긴 변
                    2048px 의 JPEG 로 항상 줄여서 올리므로 413·415 는 안전망이다.""",
            operationId = "begin_portfolio_photo_v2_portfolio_photos_post",
            tags = "v2-portfolio",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = PhotoUploadResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping("/photos")
    ResponseEntity<PhotoUploadResponse> beginPhotoUpload(
            @Valid @RequestBody PhotoUploadRequest body, HttpServletRequest request) {
        var user = auth.gatedUser(request);
        PortfolioService.NewPhotoUpload upload =
                portfolios.beginPhotoUpload(user.id(), body.contentType(), body.sizeBytes());
        return ResponseEntity.status(201)
                .body(new PhotoUploadResponse(upload.photoId(), upload.uploadUrl(), upload.expiresAt()));
    }

    @Operation(
            summary = "Complete Portfolio Photo Upload",
            description = "서버가 올라온 객체를 확인하고 목록 맨 끝에 붙인다.",
            operationId = "complete_portfolio_photo_v2_portfolio_photos__photo_id__complete_post",
            tags = "v2-portfolio",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "포트폴리오 본문",
            content = @Content(schema = @Schema(implementation = PortfolioResponse.class)))
    @PostMapping("/photos/{photo_id}/complete")
    PortfolioResponse completePhotoUpload(@PathVariable("photo_id") UUID photoId, HttpServletRequest request) {
        return portfolio(portfolios.completePhotoUpload(auth.gatedUser(request).id(), photoId));
    }

    @Operation(
            summary = "Delete Portfolio Photo",
            description = "행과 사진 객체를 함께 지운다. 이미 지운 것을 다시 지우면 404 다.",
            operationId = "delete_portfolio_photo_v2_portfolio_photos__photo_id__delete",
            tags = "v2-portfolio",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "204", description = "Successful Response")
    @DeleteMapping("/photos/{photo_id}")
    ResponseEntity<Void> deletePhoto(@PathVariable("photo_id") UUID photoId, HttpServletRequest request) {
        portfolios.deletePhoto(auth.gatedUser(request).id(), photoId);
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Order Portfolio Photos",
            description = "경력 순서 바꾸기와 같다.",
            operationId = "order_portfolio_photos_v2_portfolio_photos_order_put",
            tags = "v2-portfolio",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "포트폴리오 본문",
            content = @Content(schema = @Schema(implementation = PortfolioResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PutMapping("/photos/order")
    PortfolioResponse orderPhotos(@Valid @RequestBody OrderRequest body, HttpServletRequest request) {
        return portfolio(portfolios.orderPhotos(auth.gatedUser(request).id(), body.ids()));
    }

    @Operation(
            summary = "Set Portfolio Share",
            description = """
                    공유 링크를 켜거나 끈다. 기본은 꺼짐이다. 처음 켤 때 추측할 수 없는 난수 slug 가 생기고, 꺼도
                    남아서 다시 켜면 같은 주소가 열린다. 같은 값을 다시 보내도 200 이다.""",
            operationId = "set_portfolio_share_v2_portfolio_share_put",
            tags = "v2-portfolio",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ShareResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PutMapping("/share")
    ShareResponse share(@Valid @RequestBody ShareRequest body, HttpServletRequest request) {
        return share(portfolios.share(auth.gatedUser(request).id(), body.enabled()));
    }

    private void requireYear(int year) {
        if (!CreditRules.yearAllowed(year, portfolios.today())) {
            throw ApiValidationException.valueError(
                    List.of("body", "year"),
                    "Value error, year must be between 1900 and next year",
                    year);
        }
    }

    private static void requireText(String field, String value) {
        if (value.isBlank()) {
            throw ApiValidationException.valueError(
                    List.of("body", field), "Value error, " + field + " must not be blank", value);
        }
        if (CreditRules.length(value.strip()) > CreditRules.TEXT_MAX) {
            throw tooLong(field, value, CreditRules.TEXT_MAX);
        }
    }

    private static ApiValidationException tooLong(String field, String input, int maxLength) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", "string_too_long");
        error.put("loc", List.of("body", field));
        error.put("msg", "String should have at most " + maxLength + " characters");
        error.put("input", input);
        error.put("ctx", Map.of("max_length", maxLength));
        return new ApiValidationException(List.of(error));
    }

    private static PortfolioResponse portfolio(PortfolioService.PortfolioView view) {
        return new PortfolioResponse(
                view.intro(),
                view.credits().stream().map(PortfolioController::credit).toList(),
                view.photos().stream().map(photo -> new PhotoResponse(photo.id(), photo.url())).toList(),
                share(view.share()));
    }

    private static CreditResponse credit(Portfolio.Credit credit) {
        return new CreditResponse(credit.id(), credit.title(), credit.role(), credit.year(), credit.kind());
    }

    private static ShareResponse share(PortfolioService.ShareView share) {
        return new ShareResponse(share.enabled(), share.slug(), share.url());
    }
}
