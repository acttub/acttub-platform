package com.acttub.actingapi.feature.billing.adapter.web;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Optional;

import com.acttub.actingapi.feature.billing.app.BillingRules;
import com.acttub.actingapi.feature.billing.app.SubscriptionService;
import com.acttub.actingapi.feature.billing.app.SubscriptionService.CheckoutPage;
import com.acttub.actingapi.feature.billing.app.SubscriptionService.Result;
import com.acttub.actingapi.platform.security.ClientAddress;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 앱이 브라우저(expo-web-browser 인증 세션)로 여는 토스 카드 등록 창과 토스의 콜백(SOMA-818). 브라우저는 앱 헤더·토큰을
 * 실을 수 없어 게이트 밖이고(ClientVersionFilter·AccessTokenFilter·ConsentGateInterceptor 의 {@code /v2/billing/web/}),
 * 주소의 일회용 state(32바이트 난수, DB 에는 해시)가 곧 권한이다.
 *
 * <p>페이지는 토스 결제 SDK v2 로 카드 등록 창({@code requestBillingAuth})을 바로 띄운다. 카드 번호는 토스 화면에서만
 * 입력되고 우리 페이지·서버는 받지 않는다. 콜백은 어떤 결과든 앱 스킴 주소로 302 를 보내며 예외를 던지지 않는다 —
 * authKey 가 든 요청 주소가 오류 수집에 실리지 않는다.
 */
@Hidden
@RestController
@RequestMapping("/v2/billing/web/checkout")
class BillingCheckoutPageController {
    static final String TOSS_SDK_URL = "https://js.tosspayments.com/v2/standard";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final SubscriptionService service;
    private final FixedWindowRateLimiter limiter;
    private final ClientAddress addresses;

    BillingCheckoutPageController(SubscriptionService service, FixedWindowRateLimiter limiter, ClientAddress addresses) {
        this.service = service;
        this.limiter = limiter;
        this.addresses = addresses;
    }

    @GetMapping("/{state}")
    ResponseEntity<String> page(@PathVariable("state") String state, HttpServletRequest request) {
        if (!limiter.allow("billing-web:" + addresses.of(request), 60)) {
            return html(429, message("잠시 뒤 다시 시도해 주세요."));
        }
        Optional<CheckoutPage> page = service.page(state);
        if (page.isEmpty()) {
            return html(404, message("결제 창이 만료됐어요. 앱에서 다시 시작해 주세요."));
        }
        return html(200, checkoutHtml(page.get()));
    }

    @GetMapping("/{state}/success")
    void success(
            @PathVariable("state") String state,
            @RequestParam(name = "customerKey", required = false) String customerKey,
            @RequestParam(name = "authKey", required = false) String authKey,
            HttpServletRequest request,
            HttpServletResponse response) {
        Result result = Result.INVALID;
        try {
            if (limiter.allow("billing-callback:" + addresses.of(request), 30)) {
                result = service.complete(state, customerKey, authKey);
            }
        } catch (RuntimeException unexpected) {
            // 아무것도 싣지 않는다. 앱은 돌아와서 구독 상태를 다시 읽는다.
            result = Result.UNKNOWN;
        }
        backToApp(response, result);
    }

    @GetMapping("/{state}/fail")
    void fail(
            @PathVariable("state") String state,
            @RequestParam(name = "code", required = false) String code,
            HttpServletRequest request,
            HttpServletResponse response) {
        Result result = Result.INVALID;
        try {
            if (limiter.allow("billing-callback:" + addresses.of(request), 30)) {
                result = service.fail(state, code);
            }
        } catch (RuntimeException unexpected) {
            result = Result.FAILED;
        }
        backToApp(response, result);
    }

    private void backToApp(HttpServletResponse response, Result result) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setStatus(HttpServletResponse.SC_FOUND);
        response.setHeader(HttpHeaders.LOCATION, returnUrl(service.settings().returnUrl(), result));
    }

    static String returnUrl(String base, Result result) {
        return base + "?status=" + URLEncoder.encode(result.db(), StandardCharsets.UTF_8);
    }

    private static ResponseEntity<String> html(int status, String body) {
        return ResponseEntity.status(status)
                .contentType(new MediaType("text", "html", StandardCharsets.UTF_8))
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header("Referrer-Policy", "no-referrer")
                .header("X-Frame-Options", "DENY")
                .body(body);
    }

    private static String message(String text) {
        return shell("<p class=\"msg\">" + escape(text) + "</p>", "");
    }

    /** 페이지에 넣는 값은 JSON 문자열로만 넣는다(스크립트 주입 방지). */
    static String checkoutHtml(CheckoutPage page) {
        String config;
        try {
            java.util.Map<String, String> values = new java.util.LinkedHashMap<>();
            values.put("clientKey", page.clientKey());
            values.put("customerKey", page.customerKey());
            values.put("successUrl", page.successUrl());
            values.put("failUrl", page.failUrl());
            values.put("cancelUrl", page.returnUrl() + "?status=canceled");
            config = JSON.writeValueAsString(values).replace("<", "\\u003c");
        } catch (JsonProcessingException impossible) {
            throw new IllegalStateException(impossible);
        }
        String body = """
                <p class="title">ACTTUB Pro 정기결제</p>
                <p class="price">월 %s원</p>
                <p class="msg" id="msg">토스페이먼츠 카드 등록 창을 여는 중이에요.</p>
                <button id="retry" hidden>카드 등록 창 다시 열기</button>
                <a id="back" href="#" hidden>앱으로 돌아가기</a>
                """.formatted(String.format("%,d", BillingRules.AMOUNT));
        String script = """
                <script src="%s"></script>
                <script>
                (function () {
                  var c = %s;
                  var msg = document.getElementById('msg');
                  var retry = document.getElementById('retry');
                  var back = document.getElementById('back');
                  back.href = c.cancelUrl;
                  function open() {
                    retry.hidden = true; back.hidden = true;
                    msg.textContent = '토스페이먼츠 카드 등록 창을 여는 중이에요.';
                    if (!window.TossPayments) { fail('결제 창을 불러오지 못했어요.'); return; }
                    window.TossPayments(c.clientKey).payment({ customerKey: c.customerKey })
                      .requestBillingAuth({ method: 'CARD', successUrl: c.successUrl, failUrl: c.failUrl })
                      .catch(function (e) {
                        if (e && (e.code === 'USER_CANCEL' || e.code === 'PAY_PROCESS_CANCELED')) { location.replace(c.cancelUrl); return; }
                        fail('결제 창을 열지 못했어요.');
                      });
                  }
                  function fail(text) { msg.textContent = text; retry.hidden = false; back.hidden = false; }
                  retry.addEventListener('click', open);
                  open();
                })();
                </script>
                """.formatted(TOSS_SDK_URL, config);
        return shell(body, script);
    }

    private static String shell(String body, String script) {
        return """
                <!doctype html>
                <html lang="ko"><head><meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <meta name="robots" content="noindex">
                <title>ACTTUB Pro</title>
                <style>
                body{font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;margin:0;padding:48px 24px;color:#191F28;text-align:center}
                .title{font-size:15px;color:#6B7684;margin:0 0 6px}.price{font-size:24px;font-weight:800;margin:0 0 24px}
                .msg{font-size:15px;color:#4E5968}button{margin-top:20px;border:0;border-radius:12px;background:#0064FF;color:#fff;font-size:16px;font-weight:700;padding:14px 20px;width:100%%}
                a{display:block;margin-top:14px;color:#6B7684;font-size:15px}
                </style></head><body>
                %s
                %s
                </body></html>
                """.formatted(body, script);
    }

    private static String escape(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
