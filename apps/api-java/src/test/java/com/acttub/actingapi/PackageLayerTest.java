package com.acttub.actingapi;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

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
 * 이사해도(SOMA-397 8단계) 매칭이 그대로 성립한다. 여기에 절대 경로를 박으면 그 이사가
 * 이 파일을 함께 고치게 만든다.
 */
class PackageLayerTest {

    /**
     * 네 층으로 재편이 끝난 도메인. 옮긴 도메인을 여기 추가하는 것이 규칙 확대의 전부다.
     *
     * <p>아직 못 거는 규칙이 하나 있다 — <b>feature끼리 직접 import 금지</b>. {@code operation}은
     * 6단계에서 포트 뒤로 갔지만 {@code practice}가 여전히 {@code auth}(7단계)·{@code storage}
     * (8단계)를 직접 참조하므로, 그 둘이 끝난 뒤에 붙는다. 13단계에서 한정을 풀 때 함께 넣는다.
     */
    private static final List<String> MIGRATED_FEATURES = List.of("practice");

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
        return MIGRATED_FEATURES;
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("migratedFeatures")
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
    @MethodSource("migratedFeatures")
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

        for (String feature : MIGRATED_FEATURES) {
            for (String layer : List.of("domain", "app", "adapter", "schema")) {
                assertThat(countIn(layerOf(feature, layer)))
                        .as("%s의 %s 층에 클래스가 없다 — 층 이름이 바뀌었거나 목록에 오타가 있다", feature, layer)
                        .isPositive();
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
