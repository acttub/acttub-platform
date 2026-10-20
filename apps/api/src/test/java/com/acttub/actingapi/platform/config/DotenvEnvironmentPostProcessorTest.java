package com.acttub.actingapi.platform.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.entry;

import java.util.List;
import java.util.Map;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

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

    /**
     * 실제 파일 읽기. 이 클래스는 프로세스 작업 디렉토리({@code apps/api})의 {@code .env} 만 읽으므로 그 자리에 잠시
     * 파일을 두고 지운다. 개발자의 진짜 {@code .env} 가 있으면 덮지 않고 건너뛴다.
     */
    @Test
    void readsTheWorkingDirectoryFileOnlyWhenEnabledAndNeverOverridesRealValues() throws Exception {
        Path file = Path.of(DotenvEnvironmentPostProcessor.FILE_NAME);
        Assumptions.assumeFalse(Files.exists(file), "작업 디렉토리에 진짜 .env 가 있다");
        var processor = new DotenvEnvironmentPostProcessor(destination -> destination.get());
        try {
            Files.writeString(file, "# 로컬 설정\nACTTUB_DOTENV_PROBE=from-file\nACTTUB_DOTENV_ONLY=dotenv\n");
            MockEnvironment enabled = new MockEnvironment().withProperty("ACTTUB_DOTENV_PROBE", "real");
            MockEnvironment disabled = new MockEnvironment().withProperty("acttub.dotenv.enabled", "false");

            processor.postProcessEnvironment(enabled, null);
            processor.postProcessEnvironment(disabled, null);

            assertThat(enabled.getProperty("ACTTUB_DOTENV_PROBE")).isEqualTo("real");
            assertThat(enabled.getProperty("ACTTUB_DOTENV_ONLY")).isEqualTo("dotenv");
            assertThat(disabled.getProperty("ACTTUB_DOTENV_ONLY")).isNull();
        } finally {
            Files.deleteIfExists(file);
        }
    }

    @Test
    void commentOnlyOrUnreadableFileAndMissingFileAddNoPropertySource() throws Exception {
        Path file = Path.of(DotenvEnvironmentPostProcessor.FILE_NAME);
        Assumptions.assumeFalse(Files.exists(file), "작업 디렉토리에 진짜 .env 가 있다");
        var processor = new DotenvEnvironmentPostProcessor(destination -> destination.get());
        MockEnvironment missing = new MockEnvironment();
        MockEnvironment commentsOnly = new MockEnvironment();
        MockEnvironment broken = new MockEnvironment();
        MockEnvironment readable = new MockEnvironment();
        try {
            processor.postProcessEnvironment(missing, null);
            Files.writeString(file, "# 비어 있다\n\n");
            processor.postProcessEnvironment(commentsOnly, null);
            Files.write(file, new byte[] {'A', '=', (byte) 0xFF, (byte) 0xFE});
            processor.postProcessEnvironment(broken, null);
            Files.writeString(file, "A=1\n");
            processor.postProcessEnvironment(readable, null);
        } finally {
            Files.deleteIfExists(file);
        }

        assertThat(missing.getPropertySources().contains(DotenvEnvironmentPostProcessor.PROPERTY_SOURCE_NAME)).isFalse();
        assertThat(commentsOnly.getPropertySources().contains(DotenvEnvironmentPostProcessor.PROPERTY_SOURCE_NAME))
                .isFalse();
        assertThat(broken.getPropertySources().contains(DotenvEnvironmentPostProcessor.PROPERTY_SOURCE_NAME)).isFalse();
        assertThat(readable.getProperty("A")).isEqualTo("1");
    }

    @Test
    void singleQuoteCharacterIsNotTreatedAsAQuotedEmptyValue() {
        Map<String, Object> values = DotenvEnvironmentPostProcessor.parse(List.of("A='", "B='open"));

        assertThat(values).containsExactly(entry("A", "'"), entry("B", "'open"));
    }
}
