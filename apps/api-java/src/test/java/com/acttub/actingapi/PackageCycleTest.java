package com.acttub.actingapi;

import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

/**
 * 패키지 사이에 순환 의존이 없음을 강제한다 (ADR-016).
 *
 * <p>단일 Gradle 모듈이라 컴파일러가 의존 방향을 막아주지 않는다. 멀티 모듈로 쪼개는 대신
 * 이 검사를 관문으로 두기로 했으므로, <b>이 테스트를 지우면 방향을 지키는 장치가 사라진다.</b>
 *
 * <p>층(L0→L4)까지 박지는 않는다. 패키지 구성이 확정된 상태가 아니라, 층을 명시하면 규칙
 * 자체가 유지보수 대상이 된다.
 */
class PackageCycleTest {

    @Test
    void packagesAreFreeOfCycles() {
        JavaClasses classes = new ClassFileImporter()
                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("com.acttub.actingapi");

        slices()
                .matching("com.acttub.actingapi.(*)..")
                .should()
                .beFreeOfCycles()
                .check(classes);
    }
}
