package com.acttub.actingapi.practice;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.util.Map;
import java.util.Set;

import com.acttub.actingapi.practice.PracticeSessionDtos.PracticeSessionRequest;
import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Constraint(validatedBy = ValidBlockageBranch.Validator.class)
@interface ValidBlockageBranch {
    String message() default "sub_branch does not match blockage_kind";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    final class Validator implements ConstraintValidator<ValidBlockageBranch, PracticeSessionRequest> {
        private static final Map<String, Set<String>> ALLOWED = Map.of(
                "분석", Set.of("캐릭터 분석", "대사 분석", "그 외"),
                "표현", Set.of("감정", "움직임", "화술", "표정", "그 외"),
                "그 외", Set.of("그 외"));

        @Override
        public boolean isValid(PracticeSessionRequest value, ConstraintValidatorContext context) {
            if (value == null || value.blockageKind() == null || value.subBranch() == null) {
                return true;
            }
            Set<String> allowed = ALLOWED.get(value.blockageKind());
            return allowed == null || allowed.contains(value.subBranch());
        }
    }
}
