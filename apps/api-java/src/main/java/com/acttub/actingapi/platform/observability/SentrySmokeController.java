package com.acttub.actingapi.platform.observability;

import java.util.Map;

import io.sentry.Sentry;
import io.sentry.protocol.SentryId;
import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sentry 로 이벤트가 실제로 도착하는지 실행으로 확인하는 <b>일회용</b> 컨트롤러다.
 * {@code spec/M5-cutover.md} 의 "Sentry 에 Java 이벤트가 실제로 도착한다" 항목을 닫기 위한 것이고,
 * <b>확인이 끝나면 지운다.</b>
 *
 * <p>경로가 둘인 이유는 <b>Sentry 로 가는 길이 둘이고 성질이 다르기 때문</b>이다.
 *
 * <ul>
 *   <li>{@code /unhandled} — 아무도 처리하지 않아 500 이 되는 예외. {@code ApiErrorAdvice} 에
 *       이 타입의 {@code @ExceptionHandler} 가 없으므로 resolver 체인을 통과해
 *       {@code SentryExceptionResolver} 가 받는다. 이벤트는 {@code handled=false} 로 찍힌다
 *   <li>{@code /captured} — 잡아서 정상 응답을 내면서 {@code Sentry.captureException} 으로 따로
 *       알리는 길. {@code handled=true} 로 찍힌다. <b>워커의 {@code catch → WARNING} 자리에
 *       빠져 있는 것이 정확히 이 한 줄</b>이라, 그 방식이 실제로 도착하는지를 여기서 본다
 * </ul>
 *
 * <p><b>왜 {@code @Hidden} 인가</b> — 이 라우트가 springdoc 산출물에 실리면 관문 둘이 함께 깨진다.
 * {@code OpenApiSnapshotIT} 가 커밋된 스냅샷과 어긋나고, 계약 하네스의 openapi diff 도 난다
 * (파이썬에 없는 라우트이므로). {@code HarnessController} 가 같은 이유로 쓰는 방식이다.
 *
 * <p><b>왜 {@code /v2} 밖인가</b> — Next 의 rewrites 가 {@code /v2/*} 와 {@code /health} 만 백엔드로
 * 넘긴다. 그래서 이 경로는 {@code dev.acttub.com} 으로 접근되지 않고 인스턴스 안에서만 닿는다
 * (SSM 접속 후 {@code curl 127.0.0.1:8080/__sentry/...}). 공개 도메인에 500 을 내는 버튼을
 * 열지 않기 위한 것이고, 별도의 토큰 가드를 두지 않은 이유이기도 하다.
 *
 * <p>{@code contract} 프로파일에서는 등록하지 않는다 — 하네스 인스턴스에 없어도 되고,
 * 계약 판정 대상에 섞이지 않는 편이 깨끗하다.
 */
@Hidden
@RestController
@Profile("!contract")
@RequestMapping("/__sentry")
public class SentrySmokeController {

    /** 처리되지 않은 예외 경로. 응답은 500 이고 이벤트는 SDK 가 자동으로 만든다. */
    @GetMapping("/unhandled")
    public Map<String, String> unhandled() {
        throw new SentrySmokeException("sentry smoke: unhandled exception");
    }

    /**
     * 잡아서 처리하면서 따로 알리는 경로. 응답은 200 이고 이벤트는 이 메서드가 직접 만든다.
     *
     * <p>event id 를 돌려주는 것은 <b>대시보드에서 그 이벤트를 바로 찾기 위해서</b>다. 자동 경로
     * ({@code /unhandled})는 resolver 가 만들어 호출자가 id 를 알 수 없고 로그로 찾아야 한다.
     */
    @GetMapping("/captured")
    public Map<String, String> captured() {
        try {
            throw new SentrySmokeException("sentry smoke: handled exception");
        } catch (SentrySmokeException exception) {
            SentryId eventId = Sentry.captureException(exception);
            return Map.of("captured", "true", "event_id", eventId.toString());
        }
    }

    /**
     * 전용 타입으로 둔다. 스택트레이스 지문이 갈려 <b>실제 장애 이슈와 같은 그룹으로 묶이지
     * 않는다</b> — 확인이 끝난 뒤 이 이슈만 골라 지울 수 있다.
     */
    static class SentrySmokeException extends RuntimeException {
        SentrySmokeException(String message) {
            super(message);
        }
    }
}
