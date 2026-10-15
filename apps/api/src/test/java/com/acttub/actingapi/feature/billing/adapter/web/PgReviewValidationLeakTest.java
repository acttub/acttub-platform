package com.acttub.actingapi.feature.billing.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.web.ApiErrorAdvice;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/** 비밀번호 길이 초과 등 검증 실패 응답·로그에 비밀번호 원문이 되돌아가지 않는다. */
class PgReviewValidationLeakTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String SECRET = "S3cret-" + "x".repeat(200);

    @Test
    @SuppressWarnings("unchecked")
    void tooLongOrMalformedPasswordIsNeverEchoedInTheErrorBodyOrLogs() throws Exception {
        ListAppender<ILoggingEvent> logs = new ListAppender<>();
        logs.start();
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        root.addAppender(logs);
        try {
            ApiErrorAdvice advice = new ApiErrorAdvice(MAPPER, mock(FailureReporter.class));
            Class<?> type = Class.forName("com.acttub.actingapi.platform.web.RequestBodyTreeValidator");
            Constructor<?> constructor = type.getDeclaredConstructor(ObjectMapper.class, ApiErrorAdvice.class);
            constructor.setAccessible(true);
            Object validator = constructor.newInstance(MAPPER, advice);
            Method validate = type.getDeclaredMethod("validate", Class.class, JsonNode.class);
            validate.setAccessible(true);

            List<String> bodies = List.of(
                    "{\"username\":\"reviewer\",\"password\":\"" + SECRET + "\"}",
                    "{\"username\":\"" + "u".repeat(80) + "\",\"password\":\"" + SECRET + "\"}",
                    "{\"password\":\"" + SECRET + "\"}",
                    "{\"username\":\"reviewer\",\"password\":12345,\"pasword\":\"" + SECRET + "\"}",
                    "{\"username\":\"reviewer\",\"password\":\"\"}");
            for (String body : bodies) {
                List<Map<String, Object>> errors =
                        (List<Map<String, Object>>) validate.invoke(validator, PgReviewDtos.LoginRequest.class, MAPPER.readTree(body));
                assertThat(errors).as(body).isNotEmpty();
                var response = advice.getClass().getDeclaredMethod("validation", ApiValidationException.class);
                response.setAccessible(true);
                Object entity = response.invoke(advice, new ApiValidationException(errors));
                String json = MAPPER.writeValueAsString(((org.springframework.http.ResponseEntity<?>) entity).getBody());
                assertThat(json).as(body).doesNotContain("S3cret", SECRET);
            }
            // 길이 초과는 검증기가 직접 잡고(string_too_long) 입력은 가려진다.
            List<Map<String, Object>> tooLong = (List<Map<String, Object>>) validate.invoke(validator,
                    PgReviewDtos.LoginRequest.class,
                    MAPPER.readTree("{\"username\":\"reviewer\",\"password\":\"" + SECRET + "\"}"));
            assertThat(tooLong).hasSize(1);
            assertThat(tooLong.get(0)).containsEntry("type", "string_too_long").containsEntry("input", "[redacted]");
        } finally {
            root.detachAppender(logs);
        }
        for (ILoggingEvent event : logs.list) {
            assertThat(event.getFormattedMessage()).doesNotContain("S3cret");
        }
    }
}
