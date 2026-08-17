package com.acttub.actingapi;

import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Collectors;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.library.dependencies.SliceAssignment;
import com.tngtech.archunit.library.dependencies.SliceIdentifier;
import org.junit.jupiter.api.Test;

/**
 * 패키지 사이에 순환 의존이 없음을 강제한다 (ADR-016).
 *
 * <p>단일 Gradle 모듈이라 컴파일러가 의존 방향을 막아주지 않는다. 멀티 모듈로 쪼개는 대신
 * 이 검사를 관문으로 두기로 했으므로, <b>이 테스트를 지우면 방향을 지키는 장치가 사라진다.</b>
 *
 * <p>층(L0→L4)까지 박지는 않는다. 패키지 구성이 확정된 상태가 아니라, 층을 명시하면 규칙
 * 자체가 유지보수 대상이 된다. 층 방향은 {@link PackageLayerTest}가 따로 본다.
 *
 * <p><b>⚠ 묶음이 생기면 슬라이스를 손으로 갈라줘야 한다.</b> 종전에는
 * {@code slices().matching("com.acttub.actingapi.(*)..")} 였는데, 이 매처는 <b>첫 하위 패키지
 * 하나로만</b> 가른다. {@code platform} 접두어가 붙는 순간 그 아래 일곱 조각이 슬라이스
 * <i>하나</i>로 뭉쳐, 조각들 사이의 순환이 검사에서 사라진다 — 그런데도 테스트는 초록이다
 * (ADR-017의 ⚠). 그래서 {@link #BY_UNIT}이 묶음 접두어를 한 겹 벗겨 <b>재편 전과 같은 단위</b>로
 * 가른다. 묶음이 늘면 {@link #BUNDLES}에 이름을 더하는 것이 전부이고, <b>그것을 빠뜨리는 것이
 * 이 파일의 진짜 실패 모드다</b> — 순환은 그것을 못 잡으므로 {@link #everyBundleIsInTheList}가
 * 따로 잡는다.
 *
 * <p>🔎 <b>묶음 자체를 슬라이스로 삼는 것은 답이 아니었다.</b> 그렇게 하면 {@code platform ↔ analysis}
 * 같은 순환이 셋 잡히는데, 전부 {@code platform/harness}가 도메인을 참조하는 데서 온다 —
 * 하네스 스텁은 진짜 구현을 대체하므로 도메인을 알아야 하고(ADR-017의 "대체 구현은 진짜 구현
 * 옆에"), 도메인은 반대로 {@code platform/ledger}의 교환 타입을 쓴다. 둘 다 설계상 의도된
 * 간선이라 금지할 것이 아니다. 금지 대상은 <b>feature끼리의 직접 import</b>이고, 그 규칙은
 * 한정이 풀리는 SOMA-397 13단계에 {@link PackageLayerTest}로 들어온다.
 */
class PackageCycleTest {

    private static final String ROOT = "com.acttub.actingapi";

    /**
     * 접두어를 한 겹 벗길 묶음. 셋이 전부이고 최상위에 다른 것은 없다(SOMA-397 13단계).
     * 도메인은 {@code feature} 아래 한 겹 들어가 있으므로, 벗기면 재편 전과 같은 단위
     * ({@code practice}·{@code coach})로 갈린다.
     */
    private static final List<String> BUNDLES = List.of("feature", "platform", "integration");

    /**
     * 재편이 끝난 도메인이 갖는 층 이름(ADR-017). {@link #everyBundleIsInTheList}가 <b>묶음과
     * 도메인을 가르는 데</b> 쓴다 — 최상위 패키지가 층이 아닌 하위 패키지를 거느리면 그것은
     * 도메인이 아니라 묶음이다.
     */
    private static final Set<String> LAYERS = Set.of("domain", "app", "adapter", "schema");

    /**
     * 슬라이스 = 묶음 안 한 조각({@code platform.web}) 또는 최상위 패키지 하나({@code analysis}).
     *
     * <p>루트 직속은 {@code ActingApiApplication} 하나뿐이고 여기서 뺀다 — 종전 {@code (*)..}
     * 매처도 그것을 잡지 않았고, 스캔 기점이라 어느 조각에도 속하지 않는다.
     */
    private static final SliceAssignment BY_UNIT = new SliceAssignment() {

        @Override
        public SliceIdentifier getIdentifierOf(JavaClass javaClass) {
            return unitOf(javaClass.getPackageName())
                    .map(unit -> SliceIdentifier.of(unit))
                    .orElseGet(SliceIdentifier::ignore);
        }

        @Override
        public String getDescription() {
            return "묶음 안 한 조각 또는 최상위 패키지";
        }
    };

    /** 할당 규칙 자체. 아래 검사가 이것을 직접 부르므로 규칙과 그 검사가 같은 것을 본다. */
    private static Optional<String> unitOf(String packageName) {
        if (!packageName.startsWith(ROOT + ".")) {
            return Optional.empty();
        }
        String[] parts = packageName.substring(ROOT.length() + 1).split("\\.");
        if (!BUNDLES.contains(parts[0]) || parts.length < 2) {
            // 묶음 직속 클래스(...platform.Foo)는 묶음 이름 자체를 조각으로 삼는다. 지금은 그런
            // 클래스가 없지만, 무시하면 검사에서 조용히 빠지는 자리가 하나 생긴다.
            return Optional.of(parts[0]);
        }
        return Optional.of(parts[0] + "." + parts[1]);
    }

    private static final JavaClasses CLASSES = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages(ROOT);

    @Test
    void packagesAreFreeOfCycles() {
        slices().assignedFrom(BY_UNIT).should().beFreeOfCycles().check(CLASSES);
    }

    /**
     * 슬라이스 할당이 <b>실제로 조각을 만들고 있는지</b> 확인한다.
     *
     * <p>할당이 빗나가면 슬라이스가 하나로 뭉치거나 전부 무시되고, 그러면 순환은 정의상 나올 수
     * 없어 위 규칙이 <b>대상 없이 초록</b>이 된다. 위 ⚠가 말하는 사고가 정확히 이 형태다 —
     * 접두어를 붙이면서 할당을 안 고치면 아무것도 깨지지 않은 채 방어선만 사라진다.
     *
     * <p>이 레포는 검사가 대상 없이 통과하는 일에 이미 여러 번 당했다({@code FlywayBaselineTest}의
     * 낡은 비교쌍, {@code @EntityScan} 밖에 둔 엔티티). {@link PackageLayerTest}의 같은 이름
     * 검사와 짝을 이룬다.
     */
    @Test
    void everyBundleActuallySplitsIntoSlices() {
        Set<String> units = CLASSES.stream()
                .map(JavaClass::getPackageName)
                .map(PackageCycleTest::unitOf)
                .flatMap(Optional::stream)
                .collect(Collectors.toCollection(TreeSet::new));

        assertThat(units)
                .as("조각이 둘 미만이면 순환은 나올 수 없다 — 할당이 빗나갔다")
                .hasSizeGreaterThan(1);

        assertThat(BUNDLES)
                .as("묶음 목록이 비면 아래 루프가 아무것도 검사하지 않는다")
                .isNotEmpty();

        for (String bundle : BUNDLES) {
            assertThat(units.stream().filter(unit -> unit.startsWith(bundle + ".")).toList())
                    .as("%s 묶음이 조각으로 안 갈렸다 — 할당이 빗나갔거나 이사가 덜 끝났다", bundle)
                    .hasSizeGreaterThan(1);
        }
    }

    /**
     * <b>묶음이 목록에서 빠지지 않았는지</b> 확인한다 — 이 파일의 진짜 실패 모드다.
     *
     * <p>위 {@link #everyBundleActuallySplitsIntoSlices}는 <b>목록에 있는 것</b>만 돌므로 누락된
     * 묶음은 순회 대상조차 아니고, 순환 검사도 그 묶음이 도메인과 <b>양방향</b> 간선을 가질 때만
     * 빨간불이 난다 — {@code integration}처럼 앱 안으로 나가는 간선이 없는 묶음은 뭉쳐도 사이클에
     * 끼지 못해 <b>조용히 초록</b>이다(실측했다). 그래서 순환에 기대지 않고 여기서 직접 잡는다.
     *
     * <p>가르는 기준은 <b>하위 패키지 이름</b>이다. 재편이 끝난 도메인은 {@link #LAYERS}만
     * 거느리므로({@code practice.domain}·{@code practice.app}…) 통과하고, 층이 아닌 것을 거느리면
     * 그것은 묶음이다({@code platform.web}·{@code integration.oidc}). 아직 평평한 도메인과 공용
     * {@code schema}는 하위 패키지가 없어 통과한다.
     *
     * <p>🔎 <b>13단계 {@code feature} 이사가 정확히 이 자리에 걸렸다 — 실측했다.</b>
     * {@code platform/config}·{@code platform/harness}는 도메인으로 <i>들어가는</i> 간선만 갖고
     * 도메인이 그것을 되짚지 않으므로, 접두어를 붙이고 {@link #BUNDLES}를 빠뜨린 채 돌리면
     * 도메인 열둘이 한 슬라이스로 뭉치는데도 {@link #packagesAreFreeOfCycles}가 <b>초록</b>이다.
     * 그때 유일하게 빨간불을 낸 것이 이 검사다.
     */
    @Test
    void everyBundleIsInTheList() {
        Map<String, Set<String>> childrenByTopLevel = new TreeMap<>();
        for (JavaClass javaClass : CLASSES) {
            String packageName = javaClass.getPackageName();
            if (!packageName.startsWith(ROOT + ".")) {
                continue;
            }
            String[] parts = packageName.substring(ROOT.length() + 1).split("\\.");
            Set<String> children = childrenByTopLevel.computeIfAbsent(parts[0], key -> new TreeSet<>());
            if (parts.length >= 2) {
                children.add(parts[1]);
            }
        }

        for (Map.Entry<String, Set<String>> entry : childrenByTopLevel.entrySet()) {
            if (BUNDLES.contains(entry.getKey())) {
                continue;
            }
            assertThat(entry.getValue())
                    .as("%s 가 층이 아닌 하위 패키지를 거느린다 — 묶음이면 BUNDLES 에 이름을 더해라", entry.getKey())
                    .allMatch(LAYERS::contains);
        }
    }
}
