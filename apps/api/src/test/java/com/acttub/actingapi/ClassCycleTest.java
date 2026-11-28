package com.acttub.actingapi;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Stream;

import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.ToolProvider;

import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreeScanner;
import org.junit.jupiter.api.Test;

/**
 * {@code src/main/java} 아래 모든 패키지에서, 한 패키지 안의 클래스끼리 서로를 돌아 참조하지 않음을 강제한다(SOMA-1016·SOMA-1183).
 *
 * <p>{@link PackageCycleTest}는 패키지 사이만 본다. {@code feature/coach/app}은 클래스 스무 개가 한 묶음으로 서로를 참조하고
 * 있었고, {@code feature/reading/domain}·{@code integration/observation}·{@code feature/ads/domain}에도 두세 개씩 묶인 곳이
 * 있었다. 묶음을 푼 뒤에 막는 것이 없으면 아래 클래스가 위 클래스의 상수 하나를 읽는 것만으로 다시 묶인다. 광고 도메인의 묶음은
 * SonarQube 목록에도 없던 상수 하나였다.
 *
 * <p><b>컴파일된 클래스가 아니라 소스를 읽는다.</b> 묶음을 만들던 참조의 절반이 상수({@code static final int}·{@code String})
 * 였는데, 컴파일러가 상수 값을 쓰는 쪽에 그대로 넣어 클래스 파일에는 그 참조가 남지 않는다. ArchUnit 으로는 그 참조를 볼 수 없다.
 * 그래서 소스를 파서로 읽어 식별자를 모은다. 주석과 문자열 속 이름은 세지 않는다.
 *
 * <p>클래스 하나는 파일 하나다. 안쪽 클래스는 바깥 클래스에 합친다.
 */
class ClassCycleTest {

    private static final Path SOURCES = Path.of("src/main/java");

    @Test
    void noPackageHasClassCycles() throws IOException {
        Map<String, List<String>> cycles = new TreeMap<>();
        int packages = 0;
        int references = 0;
        try (Stream<Path> dirs = Files.walk(SOURCES)) {
            for (Path dir : dirs.filter(Files::isDirectory).toList()) {
                Map<String, String> sources = sources(dir);
                if (sources.isEmpty()) {
                    continue;
                }
                Map<String, Set<String>> uses = uses(sources);
                packages++;
                references += uses.values().stream().mapToInt(Set::size).sum();
                List<String> found = cycles(uses);
                if (!found.isEmpty()) {
                    cycles.put(SOURCES.relativize(dir).toString(), found);
                }
            }
        }

        assertThat(packages).as("패키지를 거의 못 찾았다 — 경로가 빗나갔다").isGreaterThan(100);
        assertThat(references)
                .as("참조를 거의 못 찾았다 — 파서가 이름을 못 읽는다")
                .isGreaterThan(packages);
        assertThat(cycles)
                .as("한 패키지 안에서 서로를 돌아 참조하는 클래스가 있다. 아래 클래스가 위 클래스의 상수·도우미를 읽으면 그것을 아래로 내린다")
                .isEmpty();
    }

    /** 그 폴더 바로 아래의 소스. 클래스 이름 → 글. */
    private static Map<String, String> sources(Path dir) throws IOException {
        Map<String, String> sources = new TreeMap<>();
        try (Stream<Path> files = Files.list(dir)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".java")).toList()) {
                sources.put(file.getFileName().toString().replace(".java", ""), Files.readString(file));
            }
        }
        return sources;
    }

    /** 검사가 실제로 잡는지 본다. 상수만 읽는 참조도 잡아야 하고, 주석·문자열 속 이름은 잡지 않아야 한다. */
    @Test
    void findsACycleThroughAConstantAndIgnoresCommentsAndStrings() {
        Map<String, Set<String>> uses = uses(Map.of(
                "Service", "class Service { static final int LIMIT = 8; int run() { return Helper.twice(1); } }",
                "Helper", "class Helper { static int twice(int n) { return n * Service.LIMIT; } }",
                "Leaf", "/** {@link Service} */ class Leaf { String name = \"Helper\"; Service.Inner inner; }"));

        assertThat(uses.get("Leaf")).containsExactly("Service");
        assertThat(cycles(uses)).containsExactly("Helper -> Service", "Service -> Helper");
    }

    /** 클래스마다 그 소스가 이름으로 가리키는 같은 묶음의 다른 클래스. */
    private static Map<String, Set<String>> uses(Map<String, String> sources) {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        List<JavaFileObject> units = new ArrayList<>();
        sources.forEach((name, text) -> units.add(new SimpleJavaFileObject(
                URI.create("string:///" + name + ".java"), JavaFileObject.Kind.SOURCE) {
            @Override
            public CharSequence getCharContent(boolean ignoreEncodingErrors) {
                return text;
            }
        }));
        JavacTask task = (JavacTask) compiler.getTask(null, null, diagnostic -> { }, List.of("-proc:none"), null, units);
        Map<String, Set<String>> uses = new TreeMap<>();
        try {
            for (CompilationUnitTree unit : task.parse()) {
                String name = Path.of(unit.getSourceFile().getName()).getFileName().toString().replace(".java", "");
                Set<String> names = new HashSet<>();
                new TreeScanner<Void, Void>() {
                    @Override
                    public Void visitIdentifier(IdentifierTree node, Void unused) {
                        names.add(node.getName().toString());
                        return super.visitIdentifier(node, unused);
                    }

                    @Override
                    public Void visitMemberSelect(MemberSelectTree node, Void unused) {
                        names.add(node.getIdentifier().toString());
                        return super.visitMemberSelect(node, unused);
                    }
                }.scan(unit, null);
                names.retainAll(sources.keySet());
                names.remove(name);
                uses.put(name, new TreeSet<>(names));
            }
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return uses;
    }

    /** 돌아오는 길 위에 있는 참조를 {@code "A -> B"} 꼴로 낸다. 없으면 빈 목록이다. */
    private static List<String> cycles(Map<String, Set<String>> uses) {
        Map<String, Set<String>> reach = new TreeMap<>();
        for (String start : uses.keySet()) {
            Set<String> seen = new HashSet<>();
            ArrayDeque<String> queue = new ArrayDeque<>(uses.get(start));
            while (!queue.isEmpty()) {
                String next = queue.poll();
                if (seen.add(next)) queue.addAll(uses.get(next));
            }
            reach.put(start, seen);
        }
        List<String> edges = new ArrayList<>();
        uses.forEach((from, targets) -> {
            for (String to : targets) {
                if (reach.get(to).contains(from)) edges.add(from + " -> " + to);
            }
        });
        return edges;
    }
}
