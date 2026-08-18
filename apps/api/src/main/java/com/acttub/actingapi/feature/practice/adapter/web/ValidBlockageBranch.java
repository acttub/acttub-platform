package com.acttub.actingapi.feature.practice.adapter.web;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import com.acttub.actingapi.feature.practice.adapter.web.PracticeSessionDtos.PracticeSessionRequest;
import com.acttub.actingapi.feature.practice.domain.BlockageBranch;
import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;

/**
 * 요청 본문에 {@link BlockageBranch} 의 조합 규칙을 건다.
 *
 * <p>규칙 자체는 domain 에 있고 여기는 그것을 빈 검증에 물리는 배선이다 — 애노테이션은 표기의
 * 도구라 안쪽에 둘 수 없다.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Constraint(validatedBy = ValidBlockageBranch.Validator.class)
@interface ValidBlockageBranch {
    String message() default "sub_branch does not match blockage_kind";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    final class Validator implements ConstraintValidator<ValidBlockageBranch, PracticeSessionRequest> {

        @Override
        public boolean isValid(PracticeSessionRequest value, ConstraintValidatorContext context) {
            return value == null
                    || BlockageBranch.pairs(value.blockageKind(), value.subBranch());
        }
    }
}
