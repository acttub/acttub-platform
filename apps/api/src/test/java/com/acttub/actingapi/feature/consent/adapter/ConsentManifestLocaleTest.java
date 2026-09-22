package com.acttub.actingapi.feature.consent.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.acttub.actingapi.feature.consent.domain.ConsentLocale;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 동의 문서 목록(manifest)이 말(locale) 규칙을 지키는지 본다 (SOMA-544).
 *
 * <p><b>왜 테스트로 두는가.</b> "새 판을 낼 때 한국어와 번역본을 같이 올린다"는 규칙을
 * README 에만 적어 뒀더니 곧바로 어긋났다 — 개인정보 동의가 v5 로 오르고 보관·활용 동의가
 * 새로 생기는 동안 영어판이 함께 올라오지 않아, 영어로 쓰는 사람에게 한국어 문서가 나갔다.
 * 폴백이 있어 화면이 비지는 않으므로 <b>아무도 깨진 줄 모른다.</b> 그래서 규칙을 글이 아니라
 * 여기서 막는다.
 *
 * <p>고치는 법은 둘 중 하나다 — 그 판의 번역본 `.md` 를 만들어 manifest 에 더하거나,
 * 정말 번역하지 않기로 했다면 이 테스트에 그 판을 예외로 적고 이유를 남긴다.
 */
class ConsentManifestLocaleTest {

    private record Entry(String file, String type, String version, String locale,
            String title, Boolean required) {
        String localeOrCanonical() {
            return locale == null || locale.isBlank() ? ConsentLocale.CANONICAL : locale;
        }

        String edition() {
            return type + ":" + version;
        }
    }

    private static List<Entry> manifest() throws Exception {
        try (InputStream in = ConsentManifestLocaleTest.class
                .getResourceAsStream("/consent-docs/manifest.json")) {
            assertThat(in).as("consent-docs/manifest.json 이 클래스패스에 있어야 한다").isNotNull();
            return new ObjectMapper().readValue(in, new TypeReference<List<Entry>>() { });
        }
    }

    @Test
    @DisplayName("발행하는 모든 판에 영어 번역본이 함께 있다")
    void everyEditionHasAnEnglishTranslation() throws Exception {
        Map<String, Set<String>> localesByEdition = new LinkedHashMap<>();
        for (Entry entry : manifest()) {
            localesByEdition
                    .computeIfAbsent(entry.edition(), key -> new LinkedHashSet<>())
                    .add(entry.localeOrCanonical());
        }

        assertThat(localesByEdition)
                .as("한국어만 있고 영어가 없는 판. 그 판의 번역본을 만들어 manifest 에 더한다")
                .allSatisfy((edition, locales) ->
                        assertThat(locales).as(edition).contains("ko", "en"));
    }

    @Test
    @DisplayName("한국어 정본이 없는 판은 없다 — 현행 판은 한국어가 정한다")
    void everyEditionHasTheCanonicalKorean() throws Exception {
        for (Entry entry : manifest()) {
            assertThat(ConsentLocale.isSupported(entry.localeOrCanonical()))
                    .as("%s 의 말 '%s' 은 지원하지 않는다", entry.file(), entry.locale())
                    .isTrue();
        }
    }

    @Test
    @DisplayName("목록이 가리키는 파일은 전부 실재한다")
    void everyFileExists() throws Exception {
        for (Entry entry : manifest()) {
            try (InputStream in = ConsentManifestLocaleTest.class
                    .getResourceAsStream("/consent-docs/" + entry.file())) {
                assertThat(in).as("%s 가 없다", entry.file()).isNotNull();
            }
        }
    }

    @Test
    @DisplayName("같은 판의 번역본은 필수 여부가 같다 — 말에 따라 동의 의무가 달라지면 안 된다")
    void translationsAgreeOnWhetherConsentIsRequired() throws Exception {
        Map<String, Boolean> requiredByEdition = new LinkedHashMap<>();
        for (Entry entry : manifest()) {
            Boolean seen = requiredByEdition.putIfAbsent(entry.edition(), entry.required());
            if (seen != null) {
                assertThat(entry.required())
                        .as("%s 의 필수 여부가 말마다 다르다", entry.edition())
                        .isEqualTo(seen);
            }
        }
    }
}
