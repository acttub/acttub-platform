package com.acttub.actingapi.coach;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = CoachConfirmValidator.class)
@interface ValidCoachConfirm {
    String message() default "rebuttal_text is required when confirmed is false";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
