package com.acttub.actingapi.feature.profile;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/**
 * account.profile: 개인정보 수집·이용 동의 문서의 필수 항목과 프로필 API 의 필수 항목이 같다.
 *
 * <p>필수로 받을 수 있는 것은 서비스 제공에 실제로 쓰이는 항목뿐이고, 무엇을 필수로 받는지는 동의
 * 문서가 말한다. 그래서 한쪽만 바꿀 수 없다 — API 에 필수 항목을 더하려면 문서를 <b>새 판</b>으로 내야
 * 하고(기존 회원은 게이트에서 다시 결정한다), 문서에만 있는 필수 항목은 받지도 않는 것을 받는다고
 * 알린 것이다.
 *
 * <p>대조하는 둘은 <b>지금 발행 대상인 문서</b>({@code manifest.json} 의 privacy)의 "프로필 필수 항목"
 * 표와, 커밋된 OpenAPI 스냅샷의 {@code ProfileRequest.required} 다.
 */
class ProfileConsentParityTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    /** 문서가 쓰는 말 ↔ API 의 항목 이름. 항목이 늘면 여기도 함께 는다. */
    private static final Map<String, String> FIELD_BY_LABEL = Map.of(
            "이름", "name",
            "성별", "gender",
            "생년월일", "birth_date",
            "추구하는 방향", "directions",
            "연기 경력", "experience",
            "최종 목표", "goal");

    @Test
    void requiredItemsOfTheCollectionConsentAreExactlyTheRequiredFieldsOfTheProfileApi() throws Exception {
        Set<String> documented = new LinkedHashSet<>();
        for (String label : requiredItemLabelsOfThePublishedPrivacyDocument()) {
            assertThat(FIELD_BY_LABEL)
                    .as("문서의 필수 항목 '%s' 에 대응하는 프로필 API 항목을 모른다", label)
                    .containsKey(label);
            documented.add(FIELD_BY_LABEL.get(label));
        }

        assertThat(documented)
                .as("수집·이용 동의 문서의 필수 항목 ↔ PUT /v2/me/profile 의 필수 항목")
                .containsExactlyInAnyOrderElementsOf(requiredFieldsOfTheProfileRequest());
        assertThat(documented).hasSize(6);
    }

    private static List<String> requiredItemLabelsOfThePublishedPrivacyDocument() throws Exception {
        String file = null;
        for (JsonNode entry : JSON.readTree(resource("/consent-docs/manifest.json"))) {
            // 번역본도 같은 종류로 올라온다 — 항목의 정본은 한국어 문서다 (SOMA-544).
            String locale = entry.path("locale").textValue();
            boolean korean = locale == null || locale.isBlank() || "ko".equals(locale);
            if ("privacy".equals(entry.path("type").textValue()) && korean) {
                file = entry.path("file").textValue();
                assertThat(entry.path("title").textValue()).isEqualTo("개인정보 수집·이용 동의");
                assertThat(entry.path("required").booleanValue()).isTrue();
            }
        }
        assertThat(file).as("manifest 에 privacy 문서가 있다").isNotNull();

        List<String> labels = new ArrayList<>();
        boolean inSection = false;
        for (String line : resource("/consent-docs/" + file).lines().toList()) {
            if (line.startsWith("## ")) {
                inSection = line.contains("프로필 필수 항목");
                continue;
            }
            if (inSection && line.startsWith("|") && !line.contains("---")) {
                String label = line.split("\\|")[1].strip();
                if (!"항목".equals(label)) {
                    labels.add(label);
                }
            }
        }
        assertThat(labels).as("'프로필 필수 항목' 표를 찾지 못했다").isNotEmpty();
        return labels;
    }

    private static List<String> requiredFieldsOfTheProfileRequest() throws Exception {
        JsonNode required = JSON.readTree(new String(
                        java.nio.file.Files.readAllBytes(java.nio.file.Path.of("spec/openapi.json")),
                        StandardCharsets.UTF_8))
                .path("components").path("schemas").path("ProfileRequest").path("required");
        assertThat(required.isArray()).as("openapi.json 의 ProfileRequest.required").isTrue();
        List<String> fields = new ArrayList<>();
        required.forEach(field -> fields.add(field.textValue()));
        return fields;
    }

    private static String resource(String path) throws Exception {
        try (InputStream in = ProfileConsentParityTest.class.getResourceAsStream(path)) {
            assertThat(in).as(path).isNotNull();
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
