package com.acttub.actingapi;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 외부 호출(S3·LLM)을 트랜잭션 안에 넣지 않는다 (apps/api/CONTRACT.md §5-4).
 *
 * <p>{@code claim → (수십 초) → complete} 흐름에서 커넥션을 쥔 채 Gemini·OpenAI를
 * 기다리면 풀이 마른다. 지금은 트랜잭션을 여는 store 계층과 외부 호출 계층이 타입
 * 수준에서 갈려 있는데, 그 분리는 눈으로만 지켜진다 — store에 생성기를 하나 주입하는
 * 순간 조용히 깨지고 부하가 걸려야 드러난다. 그래서 여기서 고정한다.
 */
class TransactionBoundaryTest {

    private static final Pattern EXTERNAL_CALL = Pattern.compile(
            "TextGenerator|S3Presigner|S3Storage|OpenAi|Gemini");

    @Test
    @DisplayName("트랜잭션을 여는 클래스는 외부 호출 타입을 참조하지 않는다")
    void transactionOwnersNeverReferenceExternalCalls() throws IOException {
        Path root = Paths.get("src", "main", "java");
        List<String> offenders = new ArrayList<>();

        try (Stream<Path> paths = Files.walk(root)) {
            for (Path path : paths.filter(p -> p.toString().endsWith(".java")).toList()) {
                String source = Files.readString(path);
                if (!source.contains("TransactionTemplate")) {
                    continue;
                }
                Matcher external = EXTERNAL_CALL.matcher(source);
                if (external.find()) {
                    offenders.add(root.relativize(path) + " → " + external.group());
                }
            }
        }

        assertThat(offenders)
                .describedAs("트랜잭션 안에서 외부 호출을 기다리면 커넥션이 점유된다")
                .isEmpty();
    }
}
