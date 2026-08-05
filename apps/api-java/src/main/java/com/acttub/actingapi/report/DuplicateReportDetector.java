package com.acttub.actingapi.report;

import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;

/**
 * "이미 리포트가 있어서 실패한 것"과 "그 밖의 무결성 위반"을 가른다.
 *
 * <p>Python 은 {@code exc.orig.sqlstate == "23505" and exc.orig.diag.constraint_name ==
 * "reports_session_id_key"} 로 판정한다 ({@code store.py:1300-1308}).
 * 같은 판정을 {@link PSQLException#getServerErrorMessage()} 의 {@code getConstraint()} 로 한다
 * (/SPEC.md §6 #10).
 *
 * <p><b>제약명은 {@code reports_session_id_key} 다.</b> {@code summaries_session_id_key} 가 아니다 —
 * 이 경로가 쓰는 테이블은 {@code reports} 이고, 컬럼은 {@code reports.session_id}(= coach_session id)다.
 *
 * <p>메시지 문자열 매칭을 쓰지 않는 이유: Postgres 의 오류 메시지는 {@code lc_messages} 에 따라
 * 번역되지만 {@code constraint} 필드는 번역되지 않는다.
 */
public final class DuplicateReportDetector {

    /** {@code reports.session_id} 유니크 제약. DDL 은 V1__baseline.sql 에 있다. */
    public static final String REPORTS_SESSION_ID_KEY = "reports_session_id_key";

    private static final String UNIQUE_VIOLATION = "23505";

    private DuplicateReportDetector() {
    }

    public static boolean isDuplicateReport(Throwable throwable) {
        return violatesConstraint(throwable, REPORTS_SESSION_ID_KEY);
    }

    /**
     * 예외 사슬 어딘가에 주어진 제약명의 unique violation 이 있는지 본다.
     *
     * <p>Spring 이 {@code DataIntegrityViolationException} 으로,
     * Hibernate 가 {@code ConstraintViolationException} 으로 두 번 감싸므로 사슬을 끝까지 훑는다.
     */
    public static boolean violatesConstraint(Throwable throwable, String constraintName) {
        for (Throwable current = throwable; current != null; current = current.getCause()) {
            if (!(current instanceof PSQLException psql)) {
                continue;
            }
            ServerErrorMessage error = psql.getServerErrorMessage();
            if (error == null) {
                continue;
            }
            if (UNIQUE_VIOLATION.equals(error.getSQLState())
                    && constraintName.equals(error.getConstraint())) {
                return true;
            }
            if (current.getCause() == current) {
                break;
            }
        }
        return false;
    }
}
