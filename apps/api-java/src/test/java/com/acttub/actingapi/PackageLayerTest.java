package com.acttub.actingapi;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.Set;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.library.Architectures;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * 재편이 끝난 도메인의 층 방향과 도메인 순수성을 강제한다 (ADR-017, SOMA-397 5단계).
 *
 * <p>{@link PackageCycleTest}가 순환을 막는다면 이쪽은 방향을 막는다. 서브패키지로 갈리면서
 * 저장소 클래스를 패키지 밖에서 못 쓰게 하던 package-private 보호가 사라졌으므로,
 * <b>구조를 지키는 장치는 이 검사 하나뿐이다.</b>
 *
 * <p><b>대상이 {@link #MIGRATED_FEATURES}로 한정돼 있다.</b> 아직 네 층으로 서지 않은 도메인이
 * 빨간불을 내면 재편 중간 상태와 싸우게 된다. 도메인을 옮길 때마다 목록에 추가하고, 전부
 * 옮긴 뒤(SOMA-397 13단계) 한정을 해제한다.
 *
 * <p>패턴을 {@code ..practice.domain..} 형태로 쓰는 이유 — 최상위가 {@code feature.practice}로
 * 이사해도(도메인 배치가 끝난 뒤의 마지막 이사) 매칭이 그대로 성립한다. 여기에 절대 경로를
 * 박으면 그 이사가 이 파일을 함께 고치게 만든다. 8단계가 {@code platform}·{@code integration}을
 * 세울 때 이 파일의 <b>규칙</b>은 한 줄도 안 바뀌었다(주석만 손봤다).
 */
class PackageLayerTest {

    /** 층 이름 전부. 목록에 <b>없는</b> 층이 생겼는지 보는 데도 쓴다. */
    private static final List<String> LAYERS = List.of("domain", "app", "adapter", "schema");

    private static final Set<String> FOUR_LAYERS = Set.copyOf(LAYERS);

    /**
     * 재편이 끝난 도메인과 <b>그 도메인이 실제로 가진 층</b>. 옮긴 도메인을 여기 추가하는 것이
     * 규칙 확대의 전부다.
     *
     * <p><b>층까지 적는 이유</b> — 도메인이 넷을 다 갖는다는 보장이 없다. 값이 층 이름 목록이
     * 아니라 그냥 도메인 이름이던 때는 "넷 다 있다"가 전제였고, 그 전제가 깨지는 도메인
     * (`memory`)이 11단계에 나왔다. 없는 층을 선언하면 그 규칙이 대상 0으로 조용히 통과하고,
     * 반대로 층이 새로 생겼는데 여기 안 적으면 그 층만 검사 밖에 남는다 —
     * {@link #everyRuleActuallyHasSomethingToCheck}가 양쪽을 다 본다.
     *
     * <p>아직 못 거는 규칙이 하나 있다 — <b>feature끼리 직접 import 금지</b>. {@code operation}은
     * 6단계에서, {@code auth}는 7단계에서 포트 뒤로 갔고, {@code practice}가 참조하던
     * {@code storage}·{@code web}은 8단계에서 {@code integration}·{@code platform} 뒤로 갔다.
     * 배관과 외부 연동을 보는 것은 금지 대상이 아니므로 이제 걸 수 있고, 13단계에서 한정을
     * 풀 때 함께 넣는다.
     *
     * <p>⚠ <b>그 규칙은 "상대의 {@code app} 층만 허용"으로 써야 한다</b>(ADR-019). 두 도메인이
     * 서로를 소비하면 양쪽 다 포트를 선언할 수 없다 — 구현하는 쪽이 인터페이스를 import하므로
     * 간선이 양방향이 되어 {@link PackageCycleTest}가 빨간불이다. {@code coach}→{@code report}가
     * 그 자리이고(9단계) 아홉 심볼로 정렬돼 있다. 완전 금지로 쓰면 이 형태가 걸린다.
     */
    private static final Map<String, Set<String>> MIGRATED_FEATURES = Map.of(
            "practice", FOUR_LAYERS,
            "community", FOUR_LAYERS,
            "report", FOUR_LAYERS,
            "coach", FOUR_LAYERS,
            "analysis", FOUR_LAYERS,
            "upload", FOUR_LAYERS,
            // 프로필의 Schema Entity 는 `auth/schema/UserEntity` 다 — `users` 행을 만드는 쪽이
            // 갖는다(SOMA-397 12단계). 프로필은 이미 있는 행을 고칠 뿐이라 층이 셋이다.
            "profile", Set.of("domain", "app", "adapter"),
            // 입시 요강에는 Domain Model 도 Schema Entity 도 없다. 요강은 우리가 쓰는 데이터가
            // 아니라 바깥에서 통째로 들어오는 문서라 그것에 걸리는 행위 규칙이 없고, 문서가 곧
            // 응답이라 형태는 `app` 에 산다(`report/app/PublicReport` 와 같은 자리). 네 층을
            // 세우려면 `domain` 에 넣을 것을 지어내야 하는 형태다 — ADR-017 의 판별 기준.
            "admissions", Set.of("app", "adapter"),
            // 운영 지표도 마찬가지다 — 도메인을 가로질러 세는 일이라 자기 테이블이 없고,
            // 집계한 것이 곧 응답이라 형태는 `app` 에 산다. 세는 방식은 SQL 이 갖고 있고,
            // 그것이 낸 null 을 사람이 읽는 말로 옮기는 해석도 같은 문장 옆에 남는다.
            "admin", Set.of("app", "adapter"),
            // 배우 기억은 Schema Entity 가 없다 — `actor_memory_entries` 에 대응하는 `@Entity` 가
            // 애초에 만들어진 적이 없고(그래서 그 테이블만 `ddl-auto: validate` 밖에 있다),
            // 이사에서 빠뜨린 것이 아니다. 없는 층을 선언하면 규칙이 대상 0으로 초록이 된다.
            "memory", Set.of("domain", "app", "adapter"));

    /**
     * {@code domain}이 알아서는 안 되는 것들. CONTEXT.md의 <b>Domain Model</b>은 "프레임워크를
     * 모른다"로 정의돼 있고, 그 정의가 성립해야 스프링 컨텍스트나 DB 없이 규칙을 시험할 수 있다.
     */
    private static final String[] FRAMEWORKS_DOMAIN_MUST_NOT_KNOW = {
        "org.springframework..",
        "org.hibernate..",
        "jakarta.persistence..",
        "jakarta.validation..",
        "com.fasterxml.jackson..",
        "io.swagger.."
    };

    private static final JavaClasses CLASSES = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.acttub.actingapi");

    static List<String> migratedFeatures() {
        return MIGRATED_FEATURES.keySet().stream().sorted().toList();
    }

    /**
     * 그 층을 실제로 가진 도메인만.
     *
     * <p>층별 규칙에 <b>층이 없는 도메인을 넘기면 안 된다.</b> {@code that()} 으로 대상을 좁힌
     * 규칙은 ArchUnit 이 대상 0을 스스로 실패로 치고({@link #domainKnowsNoFramework}),
     * 그렇지 않은 규칙은 반대로 대상 0으로 조용히 통과한다
     * ({@link #schemaEntitiesAreNeverCalled}). 어느 쪽이든 층 표가 답을 갖고 있다.
     */
    private static List<String> featuresWith(String layer) {
        return MIGRATED_FEATURES.entrySet().stream()
                .filter(entry -> entry.getValue().contains(layer))
                .map(Map.Entry::getKey)
                .sorted()
                .toList();
    }

    static List<String> featuresWithDomain() {
        return featuresWith("domain");
    }

    static List<String> featuresWithSchema() {
        return featuresWith("schema");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("featuresWithDomain")
    void domainKnowsNoFramework(String feature) {
        noClasses()
                .that()
                .resideInAPackage(layerOf(feature, "domain"))
                .should()
                .dependOnClassesThat()
                .resideInAnyPackage(FRAMEWORKS_DOMAIN_MUST_NOT_KNOW)
                .because("Domain Model은 스프링 컨텍스트 없이 세울 수 있어야 한다 (CONTEXT.md, ADR-017)")
                .check(CLASSES);
    }

    /**
     * 층 방향은 adapter → app → domain 한 방향이다. {@code schema}는 어느 층과도 엮이지 않는다 —
     * <b>Schema Entity</b>는 호출되지 않고 {@code ddl-auto: validate}가 대조하는 대상일 뿐이다.
     *
     * <p>{@code consideringOnlyDependenciesInLayers()}가 곧 "한정"의 구현이다. 이 도메인 밖으로
     * 나가는 의존(아직 갈리지 않은 {@code auth}·{@code operation} 등)은 검사에서 빠진다.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("migratedFeatures")
    void layersPointOneWay(String feature) {
        Architectures.layeredArchitecture()
                .consideringOnlyDependenciesInLayers()
                // 층 하나가 비어도 규칙 자체는 성립한다 — 어느 도메인이 어느 층을 갖는지는
                // MIGRATED_FEATURES 가 정하고, 그 목록이 실물과 맞는지는 아래 검사가 본다.
                .withOptionalLayers(true)
                .layer("domain").definedBy(layerOf(feature, "domain"))
                .layer("app").definedBy(layerOf(feature, "app"))
                .layer("adapter").definedBy(layerOf(feature, "adapter"))
                .layer("schema").definedBy(layerOf(feature, "schema"))
                .whereLayer("adapter").mayNotBeAccessedByAnyLayer()
                .whereLayer("schema").mayNotBeAccessedByAnyLayer()
                .whereLayer("app").mayOnlyBeAccessedByLayers("adapter")
                .whereLayer("domain").mayOnlyBeAccessedByLayers("app", "adapter")
                .because("바깥에서 안쪽으로만 향해야 규칙이 배관을 모른 채로 남는다 (ADR-017)")
                .check(CLASSES);
    }

    /**
     * Schema Entity를 아무도 호출하지 않음을 못박는다.
     *
     * <p>{@code schema/EntityMappingIT}가 개수를 세어 <b>이사 중 빠뜨림</b>을 잡는다면, 이쪽은
     * 반대로 <b>잘못 끌어다 쓰는 것</b>을 잡는다. 엔티티를 데이터 접근에 쓰기 시작하면 손으로 쓴
     * SQL과 두 벌이 되고, 그때부터 {@code validate}가 무엇을 보증하는지 흐려진다.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("featuresWithSchema")
    void schemaEntitiesAreNeverCalled(String feature) {
        noClasses()
                .that()
                .resideOutsideOfPackage(layerOf(feature, "schema"))
                .should()
                .dependOnClassesThat()
                .resideInAPackage(layerOf(feature, "schema"))
                .because("Schema Entity는 호출되지 않는다. 데이터 접근은 손으로 쓴 SQL이 한다 (CONTEXT.md)")
                .check(CLASSES);
    }

    /**
     * 위 규칙들이 <b>실재하는 클래스를 검사하고 있는지</b> 확인한다.
     *
     * <p>이 레포는 검사가 대상 없이 초록이 되는 일에 이미 두 번 당했다 — {@code FlywayBaselineTest}는
     * 비교 대상 둘이 함께 낡으면 초록이었고, {@code @EntityScan} 밖에 둔 엔티티는 검증에서 소리 없이
     * 빠졌다. 목록에 오타가 나거나 층 이름이 바뀌면 여기서 먼저 빨간불이 난다.
     *
     * <p><b>중복이 아니다.</b> ArchUnit이 대상 0을 스스로 실패로 치는 것은 {@code that()}으로 대상을
     * 좁힌 규칙뿐이다. {@link #schemaEntitiesAreNeverCalled}는 {@code resideOutsideOfPackage}로
     * 대상을 잡아 목록이 통째로 틀려도 초록이므로, 그 규칙에는 이 검사가 유일한 방어선이다.
     */
    @Test
    void everyRuleActuallyHasSomethingToCheck() {
        assertThat(MIGRATED_FEATURES)
                .as("한정 목록이 비면 위 규칙 전부가 검사 대상 없이 통과한다")
                .isNotEmpty();

        for (Map.Entry<String, Set<String>> feature : MIGRATED_FEATURES.entrySet()) {
            for (String layer : LAYERS) {
                long classes = countIn(layerOf(feature.getKey(), layer));
                if (feature.getValue().contains(layer)) {
                    assertThat(classes)
                            .as("%s의 %s 층에 클래스가 없다 — 층 이름이 바뀌었거나 목록에 오타가 있다",
                                    feature.getKey(), layer)
                            .isPositive();
                } else {
                    // 반대 방향도 본다. 층이 새로 생겼는데 목록에 안 적으면 그 층만 규칙 밖에
                    // 남는데, 위 규칙들은 그것을 알아채지 못한다.
                    assertThat(classes)
                            .as("%s가 %s 층을 갖게 됐는데 목록에 없다 — 그 층만 검사에서 빠진다",
                                    feature.getKey(), layer)
                            .isZero();
                }
            }
        }
    }

    private static String layerOf(String feature, String layer) {
        return "..%s.%s..".formatted(feature, layer);
    }

    private static long countIn(String packageIdentifier) {
        DescribedPredicate<JavaClass> resideInPackage = JavaClass.Predicates.resideInAPackage(packageIdentifier);
        return CLASSES.stream().filter(resideInPackage).count();
    }
}
