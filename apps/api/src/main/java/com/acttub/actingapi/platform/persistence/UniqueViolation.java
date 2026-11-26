package com.acttub.actingapi.platform.persistence;

import org.postgresql.util.PSQLException;

/** 예외의 원인 사슬에 이름이 {@code constraint} 인 유니크 위반(SQLSTATE 23505)이 있는지 본다. */
public final class UniqueViolation {
    private UniqueViolation() {
    }

    public static boolean of(Throwable value, String constraint) {
        for (Throwable cause = value; cause != null; cause = cause.getCause()) {
            if (cause instanceof PSQLException postgres
                    && "23505".equals(postgres.getSQLState())
                    && postgres.getServerErrorMessage() != null
                    && constraint.equals(postgres.getServerErrorMessage().getConstraint())) {
                return true;
            }
        }
        return false;
    }
}
