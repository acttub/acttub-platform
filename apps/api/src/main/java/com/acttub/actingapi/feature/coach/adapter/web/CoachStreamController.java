package com.acttub.actingapi.feature.coach.adapter.web;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import com.acttub.actingapi.feature.coach.adapter.web.ConversationDtos.ReplyRequest;
import com.acttub.actingapi.feature.coach.adapter.web.ConversationDtos.StartRequest;
import com.acttub.actingapi.feature.coach.adapter.web.ConversationDtos.TurnResultResponse;
import com.acttub.actingapi.feature.coach.app.CoachStream;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Hidden;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 코치 답 스트리밍(2026-10-16). 요청 본문·재전송·충돌 규칙은 {@code /v2/coach/start}·{@code /v2/coach/reply} 와 같고,
 * 답만 Server-Sent Events 로 나간다. 예전 앱은 그대로 두 엔드포인트를 쓴다.
 *
 * <ul>
 *   <li>모델을 부르기 전의 거절(404·409·422)은 보통 HTTP 오류다 — 아직 스트림을 열지 않았다.</li>
 *   <li>그 뒤: {@code event: delta} {@code {"text":"…"}} 는 배우에게 보일 글 조각, {@code event: done} 은
 *       {@code /reply} 와 같은 본문(저장된 답, 화면은 이것으로 덮어쓴다), {@code event: error} 는
 *       {@code {"status":502,"detail":"coach_response_unavailable"}} 처럼 HTTP 오류와 같은 값이다.</li>
 *   <li>모델을 기다리는 동안 10초마다 {@code : ping} 을 보낸다. 앞단 프록시(Next 30초)가 쉬는 연결로 보고 끊지 않게 한다.</li>
 *   <li>배우 쪽 연결이 끊겨도 답은 끝까지 만들어 저장한다. 같은 요청 id 로 {@code /reply} 를 다시 부르면 저장된 답이 온다.</li>
 * </ul>
 *
 * <p>OpenAPI 스냅샷에서는 숨긴다 — 응답이 JSON 한 덩이가 아니라 생성 타입으로 쓸 수 없고, 계약은 docs/specs/practice/coach.md 에 둔다.
 *
 * <p>요청 스레드에서 그대로 쓴다 — 외부 호출 집계(ExternalOperationExecution) 같은 스레드 범위 값이 지금 경로와 같게 유지된다.
 */
@Hidden
@RestController
@RequestMapping("/v2/coach")
class CoachStreamController {
    private static final FailureContext CONTEXT = new FailureContext("CoachStreamController");
    private static final long PING_SECONDS = 10;
    private static final ScheduledExecutorService PINGS = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "coach-stream-ping");
        thread.setDaemon(true);
        return thread;
    });

    private final ConversationService conversations;
    private final AccessGate auth;
    private final ObjectMapper mapper;
    private final FailureReporter failures;

    CoachStreamController(ConversationService conversations, AccessGate auth, ObjectMapper mapper, FailureReporter failures) {
        this.conversations = conversations;
        this.auth = auth;
        this.mapper = mapper;
        this.failures = failures;
    }

    @Operation(summary = "Start Coach Conversation (stream)", operationId = "start_coach_conversation_stream_v2_coach_start_stream_post",
            description = "/v2/coach/start 와 같다. 첫 코치 말을 text/event-stream(delta·done·error)으로 쓰는 대로 보낸다.",
            tags = "v2-coach", security = @SecurityRequirement(name = "HTTPBearer"))
    @PostMapping("/start/stream")
    void start(@Valid @RequestBody StartRequest body, HttpServletRequest request, HttpServletResponse response) {
        var userId = auth.gatedUser(request).id();
        stream(response, events -> conversations.start(userId, body.practiceId(), body.requestId(), events));
    }

    @Operation(summary = "Reply To Coach (stream)", operationId = "reply_to_coach_stream_v2_coach_reply_stream_post",
            description = "/v2/coach/reply 와 같다. 코치 답을 text/event-stream(delta·done·error)으로 쓰는 대로 보낸다.",
            tags = "v2-coach", security = @SecurityRequirement(name = "HTTPBearer"))
    @PostMapping("/reply/stream")
    void reply(@Valid @RequestBody ReplyRequest body, HttpServletRequest request, HttpServletResponse response) {
        var userId = auth.gatedUser(request).id();
        stream(response, events -> conversations.reply(
                userId, body.conversationId(), body.requestId(), body.text(), body.revision(), events));
    }

    private void stream(HttpServletResponse response, java.util.function.Function<CoachStream, ConversationService.Turn> run) {
        Events events = new Events(response);
        try {
            ConversationService.Turn turn = run.apply(events);
            events.open();
            events.send("done", mapper.writeValueAsString(TurnResultResponse.of(turn)));
        } catch (ApiException rejected) {
            // 스트림을 열기 전이면 보통 오류 응답으로 나간다(ApiErrorAdvice).
            if (!events.opened()) throw rejected;
            rejected.failureKind().ifPresent(kind -> failures.report(Objects.requireNonNull(rejected.getCause()), kind, CONTEXT));
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("status", rejected.status());
            error.put("detail", rejected.getMessage());
            error.putAll(rejected.extras());
            events.sendQuietly("error", error, mapper);
        } catch (RuntimeException | IOException failure) {
            if (!events.opened() && failure instanceof RuntimeException runtime) throw runtime;
            failures.report(failure, FailureKind.UNEXPECTED, CONTEXT);
            events.sendQuietly("error", Map.of("status", 500, "detail", "internal_server_error"), mapper);
        } finally {
            events.close();
        }
    }

    /** 한 요청의 이벤트 쓰기. 요청 스레드(조각)와 핑 스레드가 함께 쓰므로 쓰기는 하나씩이다. */
    private final class Events implements CoachStream {
        private final HttpServletResponse response;
        private OutputStream out;
        private ScheduledFuture<?> ping;
        private boolean gone;

        Events(HttpServletResponse response) {
            this.response = response;
        }

        boolean opened() {
            return out != null;
        }

        @Override
        public void begin() {
            open();
        }

        @Override
        public void delta(String text) {
            if (text == null || text.isEmpty()) return;
            try {
                send("delta", mapper.writeValueAsString(Map.of("text", text)));
            } catch (IOException ignored) {
                // 직렬화 실패는 없다. 연결이 끊긴 것은 send 가 삼킨다.
            }
        }

        synchronized void open() {
            if (out != null) return;
            response.setStatus(200);
            response.setContentType("text/event-stream");
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            // 앞단(Next·Cloudflare)이 모으거나 압축하지 않게 한다.
            response.setHeader("Cache-Control", "no-cache, no-transform");
            response.setHeader("X-Accel-Buffering", "no");
            try {
                out = response.getOutputStream();
                write(": open\n\n");
            } catch (IOException disconnected) {
                gone = true;
            }
            ping = PINGS.scheduleAtFixedRate(() -> write(": ping\n\n"), PING_SECONDS, PING_SECONDS, TimeUnit.SECONDS);
        }

        void send(String event, String data) {
            open();
            write("event: " + event + "\n" + "data: " + data.replace("\n", "\ndata: ") + "\n\n");
        }

        void sendQuietly(String event, Object data, ObjectMapper json) {
            try {
                send(event, json.writeValueAsString(data));
            } catch (IOException ignored) {
                // 오류를 알리는 중의 실패는 더 할 일이 없다.
            }
        }

        private synchronized void write(String text) {
            if (gone || out == null) return;
            try {
                out.write(text.getBytes(StandardCharsets.UTF_8));
                out.flush();
            } catch (IOException disconnected) {
                // 배우가 화면을 떠났다. 답은 끝까지 만들어 저장한다 — 다시 부르면 저장된 답이 온다.
                gone = true;
            }
        }

        synchronized void close() {
            if (ping != null) ping.cancel(false);
        }
    }
}
