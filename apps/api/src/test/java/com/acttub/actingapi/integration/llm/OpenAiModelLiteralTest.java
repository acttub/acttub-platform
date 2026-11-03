package com.acttub.actingapi.integration.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.LiteralTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreeScanner;
import org.junit.jupiter.api.Test;

/** OpenAI 글 모델 이름은 {@link OpenAiModels} 에만 둔다. 주석의 지난 측정 기록은 잡지 않도록 컴파일러로 문자열 값만 읽는다. */
class OpenAiModelLiteralTest {
    private static final Pattern MODEL = Pattern.compile("gpt-[0-9]");
    private static final Path MAIN = Path.of("src/main/java");

    @Test
    void onlyOpenAiModelsNamesAModel() throws IOException {
        try (Stream<Path> files = Files.walk(MAIN)) {
            List<Path> sources = files.filter(path -> path.toString().endsWith(".java"))
                    .filter(path -> !path.endsWith("OpenAiModels.java")).toList();
            assertThat(sources).isNotEmpty();
            assertThat(literalsNamingAModel(sources)).isEmpty();
        }
    }

    @Test
    void theScanFindsAModelInACodeLiteralAndIgnoresComments() throws IOException {
        Path source = Files.createTempFile("Violation", ".java");
        try {
            Files.writeString(source, """
                    /** gpt-5 은 주석이다. */
                    class Violation {
                        // gpt-6 도 주석이다.
                        String plain = "gpt-7-luna";
                        String block = \"""
                                gpt-8-luna
                                \""";
                        String transcribe = "gpt-transcribe";
                    }
                    """);
            assertThat(literalsNamingAModel(List.of(source))).hasSize(2)
                    .anyMatch(found -> found.contains("gpt-7-luna"))
                    .anyMatch(found -> found.contains("gpt-8-luna"));
        } finally {
            Files.delete(source);
        }
    }

    private static List<String> literalsNamingAModel(List<Path> sources) throws IOException {
        var compiler = ToolProvider.getSystemJavaCompiler();
        List<String> found = new ArrayList<>();
        try (StandardJavaFileManager files = compiler.getStandardFileManager(null, null, null)) {
            Iterable<? extends JavaFileObject> units = files.getJavaFileObjectsFromPaths(sources);
            var task = (JavacTask) compiler.getTask(null, files, diagnostic -> { }, List.of("-proc:none"), null, units);
            for (CompilationUnitTree unit : task.parse()) {
                new TreeScanner<Void, Void>() {
                    @Override
                    public Void visitLiteral(LiteralTree literal, Void ignored) {
                        if (literal.getValue() instanceof String text && MODEL.matcher(text).find()) {
                            found.add(unit.getSourceFile().getName() + ": " + text);
                        }
                        return null;
                    }
                }.scan(unit, null);
            }
        }
        return found;
    }
}
