package com.acttub.actingapi.coach.adapter.web;

import com.acttub.actingapi.coach.adapter.web.CoachDtos.CoachConfirmReq;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

final class CoachConfirmValidator implements ConstraintValidator<ValidCoachConfirm, CoachConfirmReq> {
    @Override
    public boolean isValid(CoachConfirmReq value, ConstraintValidatorContext context) {
        return value == null
                || !Boolean.FALSE.equals(value.confirmed())
                || (value.rebuttalText() != null && !value.rebuttalText().strip().isEmpty());
    }
}
