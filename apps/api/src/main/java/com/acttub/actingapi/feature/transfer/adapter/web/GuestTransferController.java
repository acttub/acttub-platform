package com.acttub.actingapi.feature.transfer.adapter.web;

import java.util.List;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.transfer.adapter.web.GuestTransferDtos.GuestTransferRequest;
import com.acttub.actingapi.feature.transfer.adapter.web.GuestTransferDtos.GuestTransferResponse;
import com.acttub.actingapi.feature.transfer.adapter.web.GuestTransferDtos.TransferCodeResponse;
import com.acttub.actingapi.feature.transfer.app.GuestTransferService;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 웹 게스트의 자료를 앱 회원에게 옮기는 두 자리. 코드를 받는 쪽은 <b>게스트만</b>이고(회원이 부르면 403
 * {@code guest_only}), 코드를 넣는 쪽은 <b>게이트를 지난 회원만</b>이다(게스트가 부르면 403
 * {@code member_only}).
 *
 * <p><b>틀린 시도만</b> 센다 — 회원당 분당 5회, IP 당 분당 10회. 여섯 자리라 세지 않으면 추측으로 남의
 * 자료를 가져갈 수 있다. 한도를 채운 뒤에는 맞는 코드도 평가하지 않는다. 422(모양이 틀린 코드)와 409
 * (기억 선택이 필요함)는 틀린 시도가 아니다.
 */
@RestController
class GuestTransferController {
    private static final Pattern SIX_DIGITS = Pattern.compile("[0-9]{6}");
    private static final int WRONG_PER_MEMBER = 5;
    private static final int WRONG_PER_IP = 10;

    private final GuestTransferService transfers;
    private final AccessGate auth;
    private final FixedWindowRateLimiter limiter;

    GuestTransferController(GuestTransferService transfers, AccessGate auth, FixedWindowRateLimiter limiter) {
        this.transfers = transfers;
        this.auth = auth;
        this.limiter = limiter;
    }

    @Operation(
            summary = "Issue Transfer Code",
            description = """
                    웹이 보여 줄 여섯 자리 숫자를 만든다. 10분 유효, 한 번 쓰면 끝, 새로 받으면 이전 코드는
                    무효다. 게스트만 부를 수 있고 필요한 동의 문서는 없다.""",
            operationId = "issue_transfer_code_v2_guest_transfer_code_post",
            tags = "v2-guest",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = TransferCodeResponse.class)))
    @PostMapping("/v2/guest/transfer-code")
    ResponseEntity<TransferCodeResponse> issueCode(HttpServletRequest request) {
        var guest = auth.guestUser(request);
        GuestTransferService.IssuedCode issued = transfers.issueCode(guest.id());
        return ResponseEntity.status(201)
                .body(new TransferCodeResponse(issued.code(), issued.expiresIn(), issued.expiresAt()));
    }

    @Operation(
            summary = "Transfer Guest Data",
            description = """
                    앱에서 코드를 넣으면 그 게스트의 자료 행의 주인을 회원으로 바꾼다. 한 트랜잭션이고, 끝나면
                    게스트 계정을 닫는다. 회원과 게스트 둘 다 배우 기억이 있는데 memory_choice 가 없으면 아무것도
                    옮기지 않고 409 다 — 코드는 살아 있다.""",
            operationId = "transfer_guest_v2_guest_transfers_post",
            tags = "v2-guest",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = GuestTransferResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/v2/guest-transfers")
    GuestTransferResponse transfer(@Valid @RequestBody GuestTransferRequest body, HttpServletRequest request) {
        var member = auth.gatedUser(request);
        if (!SIX_DIGITS.matcher(body.code()).matches()) {
            throw ApiValidationException.valueError(
                    List.of("body", "code"), "code must be six digits", body.code());
        }
        String memberKey = "transfer-wrong-member:" + member.id();
        String ipKey = "transfer-wrong-ip:" + (request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr());
        if (limiter.exhausted(memberKey, WRONG_PER_MEMBER) || limiter.exhausted(ipKey, WRONG_PER_IP)) {
            throw new ApiException(429, "rate limit exceeded");
        }
        GuestTransferService.Outcome outcome = transfers.transfer(
                member.id(), body.code(), body.memoryChoice() == null ? null : body.memoryChoice().name());
        if (outcome == GuestTransferService.Outcome.CODE_NOT_FOUND) {
            limiter.allow(memberKey, WRONG_PER_MEMBER);
            limiter.allow(ipKey, WRONG_PER_IP);
            // 틀림·만료·사용·무효를 가르지 않는다.
            throw new ApiException(404, "transfer_code_not_found");
        }
        return new GuestTransferResponse(true);
    }
}
