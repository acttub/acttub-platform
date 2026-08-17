package com.acttub.actingapi;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Stream;

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
 * 도메인의 층 방향·순수성과 도메인 사이의 간선을 강제한다 (ADR-017·018·019·020).
 *
 * <p>{@link PackageCycleTest}가 순환을 막는다면 이쪽은 방향을 막는다. 서브패키지로 갈리면서
 * 저장소 클래스를 패키지 밖에서 못 쓰게 하던 package-private 보호가 사라졌으므로,
 * <b>구조를 지키는 장치는 이 검사 하나뿐이다.</b>
 *
 * <p><b>한정이 풀렸다</b>(SOMA-397 13단계). 재편이 도는 동안 이 검사의 대상은 이미 옮긴 도메인
 * 으로 한정돼 있었다 — 아직 네 층으로 서지 않은 도메인이 빨간불을 내면 중간 상태와 싸우게
 * 되기 때문이다. 이제 {@code feature} 아래가 전부 재편됐으므로 <b>표에 없는 도메인이 있으면
 * 그것이 실패다</b>({@link #everyFeatureIsInTheTable}). 종전에는 목록에서 빠진 도메인이 아무
 * 검사 없이 통과했고, 그 대가는 재편 기간에만 유효한 것이었다.
 *
 * <p>패턴을 {@code ..practice.domain..} 형태로 쓴 것이 13단계에서 값을 냈다 — 도메인이
 * {@code feature.practice}로 이사했는데 <b>이 파일의 규칙은 한 줄도 바뀌지 않았다</b>. 8단계가
 * {@code platform}·{@code integration}을 세울 때도 같았다(주석만 손봤다).
 */
class PackageLayerTest {

    /** 비즈니스 묶음. {@link #everyFeatureIsInTheTable}이 이 아래를 훑어 표와 대조한다. */
    private static final String FEATURE_ROOT = "com.acttub.actingapi.feature";

    /** 층 이름 전부. 목록에 <b>없는</b> 층이 생겼는지 보는 데도 쓴다. */
    private static final List<String> LAYERS = List.of("domain", "app", "adapter", "schema");

    private static final Set<String> FOUR_LAYERS = Set.copyOf(LAYERS);

    /**
     * 도메인과 <b>그 도메인이 실제로 가진 층</b>. {@code feature} 아래 전부가 여기 있어야 한다
     * ({@link #everyFeatureIsInTheTable}).
     *
     * <p><b>층까지 적는 이유</b> — 도메인이 넷을 다 갖는다는 보장이 없다(ADR-020). 값이 층 이름
     * 목록이 아니라 그냥 도메인 이름이던 때는 "넷 다 있다"가 전제였고, 그 전제가 깨지는 도메인
     * (`memory`)이 11단계에 나왔다. 없는 층을 선언하면 그 규칙이 대상 0으로 조용히 통과하고,
     * 반대로 층이 새로 생겼는데 여기 안 적으면 그 층만 검사 밖에 남는다 —
     * {@link #everyRuleActuallyHasSomethingToCheck}가 양쪽을 다 본다.
     */
    private static final Map<String, Set<String>> FEATURE_LAYERS = Map.ofEntries(
            Map.entry("practice", FOUR_LAYERS),
            Map.entry("community", FOUR_LAYERS),
            Map.entry("report", FOUR_LAYERS),
            Map.entry("coach", FOUR_LAYERS),
            Map.entry("analysis", FOUR_LAYERS),
            Map.entry("upload", FOUR_LAYERS),
            // 프로필의 Schema Entity 는 `auth/schema/UserEntity` 다 — `users` 행을 만드는 쪽이
            // 갖는다(SOMA-397 12단계). 프로필은 이미 있는 행을 고칠 뿐이라 층이 셋이다.
            Map.entry("profile", Set.of("domain", "app", "adapter")),
            // 입시 요강에는 Domain Model 도 Schema Entity 도 없다. 요강은 우리가 쓰는 데이터가
            // 아니라 바깥에서 통째로 들어오는 문서라 그것에 걸리는 행위 규칙이 없고, 문서가 곧
            // 응답이라 형태는 `app` 에 산다(`report/app/PublicReport` 와 같은 자리). 네 층을
            // 세우려면 `domain` 에 넣을 것을 지어내야 하는 형태다 — ADR-017 의 판별 기준.
            Map.entry("admissions", Set.of("app", "adapter")),
            // 운영 지표도 마찬가지다 — 도메인을 가로질러 세는 일이라 자기 테이블이 없고,
            // 집계한 것이 곧 응답이라 형태는 `app` 에 산다. 세는 방식은 SQL 이 갖고 있고,
            // 그것이 낸 null 을 사람이 읽는 말로 옮기는 해석도 같은 문장 옆에 남는다.
            Map.entry("admin", Set.of("app", "adapter")),
            Map.entry("auth", FOUR_LAYERS),
            Map.entry("consent", FOUR_LAYERS),
            // 배우 기억은 Schema Entity 가 없다 — `actor_memory_entries` 에 대응하는 `@Entity` 가
            // 애초에 만들어진 적이 없고(그래서 그 테이블만 `ddl-auto: validate` 밖에 있다),
            // 이사에서 빠뜨린 것이 아니다. 없는 층을 선언하면 규칙이 대상 0으로 초록이 된다.
            Map.entry("memory", Set.of("domain", "app", "adapter")));

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

    static List<String> features() {
        return FEATURE_LAYERS.keySet().stream().sorted().toList();
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
        return FEATURE_LAYERS.entrySet().stream()
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
     * <p>{@code consideringOnlyDependenciesInLayers()}는 <b>이 도메인 안의 간선만</b> 본다. 밖으로
     * 나가는 것 — 배관·외부 연동, 그리고 다른 도메인 — 은 여기서 빠지고, 마지막 것은
     * {@link #featuresSeeOnlyEachOthersAppLayer}가 따로 본다.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("features")
    void layersPointOneWay(String feature) {
        Architectures.layeredArchitecture()
                .consideringOnlyDependenciesInLayers()
                // 층 하나가 비어도 규칙 자체는 성립한다 — 어느 도메인이 어느 층을 갖는지는
                // FEATURE_LAYERS 가 정하고, 그 목록이 실물과 맞는지는 아래 검사가 본다.
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
     * 도메인끼리는 <b>상대의 {@code app} 층만</b> 본다 (ADR-017·019).
     *
     * <p>완전 금지로 쓸 수 없다. 두 도메인이 서로를 소비하면 양쪽 다 포트를 선언할 수 없어서다 —
     * 구현하는 쪽이 인터페이스를 import하므로 간선이 양방향이 되어 {@link PackageCycleTest}가
     * 빨간불이다. {@code coach}↔{@code report}가 그 자리였고(9단계), 한쪽만 포트로 뒤집어
     * {@code coach → report/app} 한 방향으로 정렬했다. 그래서 상대가 알아야 하는 타입(교환 record,
     * 공개 스키마)이 {@code app}에 산다.
     *
     * <p>지금 걸려 있는 간선은 셋뿐이고 전부 {@code app}만 본다 — {@code coach}→{@code report} 12 ·
     * {@code consent}→{@code auth} 2 · {@code memory}→{@code coach} 2. <b>폭이 늘면 그것이 두
     * 도메인을 합쳐야 한다는 신호다</b>(ADR-019). 이 검사는 폭을 세지 않는다 — 세기 시작하면
     * 숫자가 곧 유지보수 대상이 되고, 판단은 사람이 해야 한다.
     *
     * <p>배관과 외부 연동을 보는 것은 금지 대상이 아니다({@code auth/app/AuthService}가
     * {@code integration/oidc}를 직접 부른다). 반대로 배관이 도메인 포트를 구현하는 것도 여기서
     * 안 본다 — {@code that()}이 {@code feature} 안으로 대상을 좁히기 때문이고, 그 형태는
     * {@code platform/security}·{@code platform/operation}이 이미 쓰고 있다.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("features")
    void featuresSeeOnlyEachOthersAppLayer(String feature) {
        String[] hidden = features().stream()
                .filter(other -> !other.equals(feature))
                .flatMap(other -> Stream.of("domain", "adapter", "schema").map(layer -> layerOf(other, layer)))
                .toArray(String[]::new);

        noClasses()
                .that()
                .resideInAPackage(featureOf(feature))
                .should()
                .dependOnClassesThat()
                .resideInAnyPackage(hidden)
                .because("도메인은 상대의 app 층만 본다. 그래야 한 도메인만 읽고 끝낼 수 있다 (ADR-019)")
                .check(CLASSES);
    }

    /**
     * <b>표에서 빠진 도메인이 없는지</b> 확인한다 — 이것이 "한정 해제"의 실체다 (SOMA-397 13단계).
     *
     * <p>{@link #everyRuleActuallyHasSomethingToCheck}는 <b>표에 있는 것</b>만 순회하므로, 도메인
     * 하나를 새로 만들고 표에 안 적으면 그 도메인 통째가 검사 밖에 남는다. 재편이 도는 동안은
     * 그것이 의도된 대가였지만(옮기지 않은 도메인이 빨간불을 내지 않게 하려는 한정), 이제는 아니다.
     *
     * <p>{@link PackageCycleTest#everyBundleIsInTheList}와 같은 부류의 검사다 — 목록을 도는 검사는
     * 목록에서 빠진 것을 영원히 못 본다.
     */
    @Test
    void everyFeatureIsInTheTable() {
        assertThat(childrenByFeature().keySet())
                .as("feature 아래 도메인과 층 표가 어긋난다 — 표에 없는 도메인은 검사 밖에 남는다")
                .isEqualTo(new TreeSet<>(FEATURE_LAYERS.keySet()));
    }

    /**
     * 도메인이 <b>층만</b> 거느리는지 본다.
     *
     * <p>⚠ <b>이 검사는 13단계에 새로 필요해졌다.</b> 종전에는 도메인이 최상위에 있어
     * {@link PackageCycleTest#everyBundleIsInTheList}가 같은 것을 봤다 — "층이 아닌 하위 패키지를
     * 거느린 최상위" 를 걸러내면서 도메인의 자식도 함께 검사했다. 그런데 {@code feature}가
     * {@code BUNDLES}에 들어가면서 그 검사가 이 묶음을 통째로 건너뛴다.
     *
     * <p>🔥 <b>그러면 {@code feature/practice/util} 같은 패키지를 아무도 못 본다</b> —
     * {@link #everyFeatureIsInTheTable}은 첫 마디만 보고, {@link #everyRuleActuallyHasSomethingToCheck}는
     * {@link #LAYERS} 넷만 순회하며, {@link #layersPointOneWay}는 {@code consideringOnlyDependenciesInLayers()}
     * 라 선언 안 된 패키지를 무시한다. 실제로 만들어 넷 다 초록인 것을 확인했다.
     */
    @Test
    void everyFeatureSubpackageIsALayer() {
        childrenByFeature().forEach((feature, children) -> assertThat(children)
                .as("%s 가 층이 아닌 하위 패키지를 거느린다 — 층 규칙 어느 것도 그것을 보지 않는다", feature)
                .allMatch(LAYERS::contains));
    }

    /** 도메인 → 그 도메인이 실제로 거느린 하위 패키지. 위 두 검사가 같은 실물을 본다. */
    private static Map<String, Set<String>> childrenByFeature() {
        Map<String, Set<String>> children = new TreeMap<>();
        for (JavaClass javaClass : CLASSES) {
            String packageName = javaClass.getPackageName();
            if (!packageName.startsWith(FEATURE_ROOT + ".")) {
                continue;
            }
            String[] parts = packageName.substring(FEATURE_ROOT.length() + 1).split("\\.");
            Set<String> layers = children.computeIfAbsent(parts[0], key -> new TreeSet<>());
            if (parts.length >= 2) {
                layers.add(parts[1]);
            }
        }
        return children;
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
        // 둘 미만이면 featuresSeeOnlyEachOthersAppLayer 의 금지 목록이 비어 그 규칙이 공허하게
        // 초록이 된다 — that() 대상은 있으므로 ArchUnit 도 그것을 실패로 치지 않는다.
        assertThat(FEATURE_LAYERS)
                .as("층 표가 둘 미만이면 위 규칙 일부가 검사 대상 없이 통과한다")
                .hasSizeGreaterThan(1);

        for (Map.Entry<String, Set<String>> feature : FEATURE_LAYERS.entrySet()) {
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

    /**
     * ⚠ <b>여기만 절대 경로다.</b> {@code ..admin..} 상대형으로 두면 배관에 같은 이름의 조각이
     * 생기는 순간({@code platform/admin}) 규칙 대상이 거기까지 번져, "배관이 도메인 포트를
     * 구현하는 것은 대상 밖" 이라는 이 규칙의 전제가 깨진다. 오늘 초록인 것은 이름이 겹치지
     * 않아서일 뿐이라 — 실제로 겹치게 만들어 빨간불을 확인했다.
     *
     * <p>{@link #layerOf}가 상대형인 것과는 반대다. 그쪽은 도메인이 어디로 이사해도 성립해야
     * 하는 패턴이고, 이쪽은 <b>{@code feature} 아래인지</b>가 규칙의 뜻 자체다.
     */
    private static String featureOf(String feature) {
        return "%s.%s..".formatted(FEATURE_ROOT, feature);
    }

    private static String layerOf(String feature, String layer) {
        return "..%s.%s..".formatted(feature, layer);
    }

    private static long countIn(String packageIdentifier) {
        DescribedPredicate<JavaClass> resideInPackage = JavaClass.Predicates.resideInAPackage(packageIdentifier);
        return CLASSES.stream().filter(resideInPackage).count();
    }
}
