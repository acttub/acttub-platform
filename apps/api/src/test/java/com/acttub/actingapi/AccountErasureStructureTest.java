package com.acttub.actingapi;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.DeletedPracticeAccount;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasurePart;
import com.acttub.actingapi.feature.video.app.PracticeGroupVideos;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 계정을 닫을 때 자기 몫을 지우는 구현({@link AccountErasure})은 트랜잭션을 열지 않는다 (ADR-040, apps/api/CONTRACT.md §6-8).
 *
 * <p>구현이 자기 {@code TransactionTemplate} 이나 {@code @Transactional(REQUIRES_NEW)} 로 따로 커밋하면, 뒤의 구현이 실패해
 * 탈퇴가 되돌아가도 그 기능의 자료만 지워진 채 남는다. 실제로 되돌아가는지는 {@code AccountErasureRollbackIT} 가 본다.
 */
class AccountErasureStructureTest {

    /**
     * 옮기지 않은 자리를 맡고 있는 동안만 빠진다. 이 저장소는 프로필 저장 같은 다른 일의 트랜잭션을 여는 {@code TransactionTemplate}
     * 을 쥐고 있다. 자리를 모두 주인에게 넘기면 이 줄을 지운다.
     */
    private static final String STILL_HOLDING_UNMOVED_STEPS =
            "com.acttub.actingapi.feature.profile.adapter.db.PostgresProfileRepository";

    private static final JavaClasses CLASSES = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.acttub.actingapi");

    @Test
    @DisplayName("AccountErasure 구현은 Spring 의 트랜잭션 타입(TransactionTemplate, @Transactional 등)에 기대지 않는다")
    void erasuresNeverOpenATransaction() {
        assertThat(CLASSES.stream()
                .filter(type -> type.isAssignableTo(AccountErasure.class) && !type.isInterface())
                .filter(type -> !type.getName().equals(STILL_HOLDING_UNMOVED_STEPS)))
                .as("규칙이 볼 구현이 없으면 아래 규칙이 조용히 통과한다")
                .isNotEmpty();

        noClasses()
                .that().implement(AccountErasure.class)
                .and().doNotHaveFullyQualifiedName(STILL_HOLDING_UNMOVED_STEPS)
                .should().dependOnClassesThat().resideInAPackage("org.springframework.transaction..")
                .because("계정을 닫는 트랜잭션에 참여해야 한다. 따로 커밋하면 일부만 지워진 계정이 남는다")
                .check(CLASSES);
    }

    @Test
    @DisplayName("연습 삭제에서 다른 기능이 맡는 몫(PracticeGroupErasurePart, 영상, 보관 계정)도 Spring 의 트랜잭션 타입에 기대지 않는다")
    void practiceGroupPartsNeverOpenATransaction() {
        for (Class<?> port : List.of(PracticeGroupErasurePart.class, PracticeGroupVideos.class, DeletedPracticeAccount.class)) {
            assertThat(CLASSES.stream().filter(type -> type.isAssignableTo(port) && !type.isInterface()))
                    .as("%s 의 구현이 없으면 아래 규칙이 조용히 통과한다", port.getSimpleName())
                    .isNotEmpty();

            noClasses()
                    .that().implement(port)
                    .should().dependOnClassesThat().resideInAPackage("org.springframework.transaction..")
                    .because("연습을 지우는 트랜잭션에 참여해야 한다. 따로 커밋하면 반만 지워진 묶음이 남는다")
                    .check(CLASSES);
        }
    }
}
