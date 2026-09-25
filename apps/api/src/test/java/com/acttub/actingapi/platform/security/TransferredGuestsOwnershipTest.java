package com.acttub.actingapi.platform.security;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.util.Arrays;

import com.acttub.actingapi.feature.auth.app.AuthRepository;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 한 포트는 한 쪽만 구현한다 — 소유가 갈리면 포트도 갈린다 (docs/ADR.md ADR-017). */
class TransferredGuestsOwnershipTest {

    @Test
    @DisplayName("account.guest: '옮겨진 게스트인가'는 이관 코드의 주인인 transfer 가 답한다 — auth 가 구현하는 포트에 섞지 않는다")
    void transferredGuestsIsAnsweredByTheOwnerOfTheTransferCodes() {
        JavaClasses production = new ClassFileImporter()
                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("com.acttub.actingapi");

        classes().that().implement(TransferredGuests.class)
                .should().resideInAPackage("com.acttub.actingapi.feature.transfer.adapter..")
                .check(production);
        assertThat(methodNames(AuthenticatedUsers.class)).containsExactly("find");
        assertThat(methodNames(AuthRepository.class)).doesNotContain("transferredGuest");
    }

    private static java.util.List<String> methodNames(Class<?> port) {
        return Arrays.stream(port.getDeclaredMethods()).map(Method::getName).sorted().toList();
    }
}
