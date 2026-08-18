package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 가입 시점의 유입 출처. 원본은 {@code auth/router.py:SignupAttribution} 이다.
 *
 * <p><b>유입 정보는 부가 데이터라 잘못됐다고 인증을 422 로 막지 않는다.</b> 어긋난
 * 입력은 조용히 통째로 버리고 로그인은 그대로 진행한다 — 그 판단이 pydantic
 * validator 둘에 나뉘어 있어서, Java 에서는 {@link Deserializer} 하나로 모은다.
 */
@Schema(name = "SignupAttribution")
@JsonDeserialize(using = SignupAttribution.Deserializer.class)
public record SignupAttribution(
        @Schema(title = "Utm Source", nullable = true) @JsonProperty("utm_source") String utmSource,
        @Schema(title = "Utm Medium", nullable = true) @JsonProperty("utm_medium") String utmMedium,
        @Schema(title = "Utm Campaign", nullable = true) @JsonProperty("utm_campaign") String utmCampaign,
        @Schema(title = "Utm Id", nullable = true) @JsonProperty("utm_id") String utmId,
        @Schema(title = "Utm Content", nullable = true) @JsonProperty("utm_content") String utmContent,
        @Schema(title = "Utm Term", nullable = true) @JsonProperty("utm_term") String utmTerm,
        @Schema(title = "Referrer Host", nullable = true) @JsonProperty("referrer_host") String referrerHost,
        @Schema(title = "Landing Path", nullable = true) @JsonProperty("landing_path") String landingPath,
        @Schema(title = "First Seen At", nullable = true) @JsonProperty("first_seen_at") Instant firstSeenAt) {

    /** 원본 {@code sanitize_string} 이 자르는 길이. */
    private static final int MAX_LENGTH = 255;

    private static final String[] STRING_FIELDS = {
        "utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_content",
        "utm_term", "referrer_host", "landing_path"
    };

    public static class Deserializer extends JsonDeserializer<SignupAttribution> {

        @Override
        public SignupAttribution deserialize(JsonParser parser, DeserializationContext context)
                throws java.io.IOException {
            JsonNode node = parser.readValueAsTree();
            return parse(node);
        }

        /** 되돌려주는 {@code null} 은 "이 입력은 통째로 버린다" 는 뜻이다. */
        static SignupAttribution parse(JsonNode node) {
            // 원본 discard_invalid_attribution: dict 도 모델도 아니면 버린다.
            if (node == null || node.isNull() || !node.isObject()) {
                return null;
            }
            // 문자열 자리에 문자열 아닌 것이 오면 그 필드만이 아니라 전체를 버린다.
            for (String field : STRING_FIELDS) {
                JsonNode value = node.get(field);
                if (value != null && !value.isNull() && !value.isTextual()) {
                    return null;
                }
            }
            JsonNode firstSeen = node.get("first_seen_at");
            if (firstSeen != null && !firstSeen.isNull() && !firstSeen.isTextual()) {
                return null;
            }
            Instant parsedFirstSeen = null;
            if (firstSeen != null && firstSeen.isTextual()) {
                try {
                    // OffsetDateTime 은 offset 이 있어야 파싱된다 — 원본의
                    // "tzinfo 가 없으면 버린다" 와 같은 판정이 여기서 난다.
                    parsedFirstSeen = OffsetDateTime.parse(firstSeen.asText()).toInstant();
                } catch (DateTimeParseException notAnInstant) {
                    return null;
                }
            }
            return new SignupAttribution(
                    sanitize(node.get("utm_source")),
                    sanitize(node.get("utm_medium")),
                    sanitize(node.get("utm_campaign")),
                    sanitize(node.get("utm_id")),
                    sanitize(node.get("utm_content")),
                    sanitize(node.get("utm_term")),
                    sanitize(node.get("referrer_host")),
                    sanitize(node.get("landing_path")),
                    parsedFirstSeen);
        }

        /** 원본 {@code sanitize_string}: 제어문자 제거 → strip → 255 절단 → 비면 null. */
        private static String sanitize(JsonNode node) {
            if (node == null || !node.isTextual()) {
                return null;
            }
            StringBuilder builder = new StringBuilder();
            node.asText().codePoints()
                    .filter(codePoint -> Character.getType(codePoint) != Character.CONTROL)
                    .forEach(builder::appendCodePoint);
            String cleaned = builder.toString().strip();
            // 파이썬의 [:255] 는 코드포인트 기준이다. substring 은 UTF-16 char 기준이라
            // 서로게이트 페어(이모지)가 섞이면 자르는 위치가 달라진다.
            if (cleaned.codePointCount(0, cleaned.length()) > MAX_LENGTH) {
                cleaned = cleaned.substring(0, cleaned.offsetByCodePoints(0, MAX_LENGTH));
            }
            return cleaned.isEmpty() ? null : cleaned;
        }
    }
}
