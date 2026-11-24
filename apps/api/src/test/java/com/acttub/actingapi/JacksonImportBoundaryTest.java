package com.acttub.actingapi;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import org.junit.jupiter.api.Test;

/**
 * Jackson 2 의 databind·core 는 swagger-core(OpenAPI 문서)와 맞닿은 {@code platform.config.SwaggerJackson3Bridge} 에서만
 * 쓴다(SOMA-1103). 앱의 JSON 은 Jackson 3 이다. 주석 패키지({@code com.fasterxml.jackson.annotation})는 Jackson 3 도
 * 그대로 쓰므로 막지 않는다. 테스트 코드도 같은 규칙이다.
 */
class JacksonImportBoundaryTest {

    private static final String BRIDGE = "com.acttub.actingapi.platform.config.SwaggerJackson3Bridge";

    @Test
    void onlyTheSwaggerBridgeTouchesJackson2() {
        noClasses()
                .that().doNotHaveFullyQualifiedName(BRIDGE)
                .and().haveNameNotMatching(java.util.regex.Pattern.quote(BRIDGE) + "\\$.*")
                .should().dependOnClassesThat()
                .resideInAnyPackage("com.fasterxml.jackson.databind..", "com.fasterxml.jackson.core..")
                .because("앱의 JSON 은 Jackson 3 이다. Jackson 2 는 swagger-core 가 안에서만 쓴다")
                .check(new ClassFileImporter().importPackages("com.acttub.actingapi"));
    }
}
