package com.acttub.actingapi.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.entry;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * {@code .env} 파싱 규칙을 고정한다. 같은 파일을 파이썬 {@code python-dotenv} 도 읽으므로
 * (로컬에서는 {@code apps/api/acting-api/.env} 하나를 심링크로 공유한다) 두 쪽 해석이
 * 갈리면 백엔드마다 다른 설정으로 뜨게 된다.
 */
class DotenvEnvironmentPostProcessorTest {

    @Test
    void readsSimpleKeyValuePairs() {
        Map<String, Object> values = DotenvEnvironmentPostProcessor.parse(
                List.of("GEMINI_MODEL=gemini-3-flash-preview", "S3_BUCKET=acttub-practice-videos-dev"));

        assertThat(values)
                .containsExactly(
                        entry("GEMINI_MODEL", "gemini-3-flash-preview"),
                        entry("S3_BUCKET", "acttub-practice-videos-dev"));
    }

    @Test
    void skipsCommentsAndBlankLines() {
        Map<String, Object> values = DotenvEnvironmentPostProcessor.parse(
                List.of("# 주석입니다", "", "   ", "JWT_SECRET=abc", "  # 들여쓴 주석"));

        assertThat(values).containsExactly(entry("JWT_SECRET", "abc"));
    }

    @Test
    void keepsEqualsSignsInsideValue() {
        // DATABASE_URL 의 쿼리스트링이나 base64 로 끝나는 토큰이 여기 걸린다.
        Map<String, Object> values = DotenvEnvironmentPostProcessor.parse(
                List.of("DATABASE_URL=postgresql://u:p@localhost:5432/db?sslmode=require"));

        assertThat(values)
                .containsEntry("DATABASE_URL", "postgresql://u:p@localhost:5432/db?sslmode=require");
    }

    @Test
    void stripsSurroundingQuotes() {
        Map<String, Object> values = DotenvEnvironmentPostProcessor.parse(
                List.of("A=\"double\"", "B='single'", "C=\"안 닫힘", "D=say \"hi\""));

        assertThat(values)
                .containsEntry("A", "double")
                .containsEntry("B", "single")
                .containsEntry("C", "\"안 닫힘")
                .containsEntry("D", "say \"hi\"");
    }

    @Test
    void acceptsExportPrefix() {
        Map<String, Object> values = DotenvEnvironmentPostProcessor.parse(List.of("export OPENAI_API_KEY=sk-test"));

        assertThat(values).containsExactly(entry("OPENAI_API_KEY", "sk-test"));
    }

    @Test
    void dropsLinesWithoutKey() {
        Map<String, Object> values = DotenvEnvironmentPostProcessor.parse(
                List.of("=값만", "키만있음", "=", "OK=1"));

        assertThat(values).containsExactly(entry("OK", "1"));
    }

    @Test
    void trimsWhitespaceAroundKeyAndValue() {
        Map<String, Object> values = DotenvEnvironmentPostProcessor.parse(List.of("  KEY  =  value  "));

        assertThat(values).containsExactly(entry("KEY", "value"));
    }

    @Test
    void runsBeforeTheDatabaseUrlPostProcessor() {
        // .env 가 DATABASE_URL 을 공급할 수 있으므로 순서가 뒤집히면 그 값을 못 본다.
        int dotenv = new DotenvEnvironmentPostProcessor(name -> null).getOrder();
        int databaseUrl = new DatabaseUrlEnvironmentPostProcessor().getOrder();

        assertThat(dotenv).isLessThan(databaseUrl);
    }
}
