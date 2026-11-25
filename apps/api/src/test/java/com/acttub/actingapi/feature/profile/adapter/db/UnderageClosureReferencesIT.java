package com.acttub.actingapi.feature.profile.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashSet;
import java.util.Set;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 만 14세 미만 정리({@link PostgresProfileRepository#closeUnderage})가 보는 표 목록과 DB 의 외래 키를 맞춰 본다.
 *
 * <p>자료가 없다고 보면 {@code DELETE FROM users} 로 계정 행을 지운다. {@code users} 를 ON DELETE 없이 무는 표가 목록에
 * 빠져 있으면 그 표에 행이 있을 때 지우기가 외래 키로 실패한다. 새 표를 더할 때 목록을 같이 고치게 여기서 잡는다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class UnderageClosureReferencesIT {

    @Autowired
    JdbcTemplate jdbc;

    @Test
    @DisplayName("users 를 지우기 막는 외래 키(ON DELETE 없음)는 모두 기록 확인 목록이나 함께 지우는 표에 있다")
    void everyBlockingForeignKeyToUsersIsChecked() {
        Set<String> blocking = new LinkedHashSet<>(jdbc.queryForList("""
                SELECT child.relname || '.' || att.attname
                FROM pg_constraint con
                JOIN pg_class child ON child.oid = con.conrelid
                JOIN pg_class parent ON parent.oid = con.confrelid
                JOIN pg_namespace ns ON ns.oid = child.relnamespace
                JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
                WHERE con.contype = 'f' AND parent.relname = 'users' AND ns.nspname = current_schema()
                  AND con.confdeltype IN ('a', 'r')
                ORDER BY 1
                """, String.class));
        assertThat(blocking).as("질의가 비면 아래 비교가 조용히 통과한다").isNotEmpty();

        Set<String> covered = new LinkedHashSet<>();
        PostgresProfileRepository.HISTORY.forEach(ref -> covered.add(ref.table() + "." + ref.column()));
        PostgresProfileRepository.ERASED_WITH_THE_ACCOUNT.forEach(table -> covered.add(table + ".user_id"));

        assertThat(covered)
                .as("빠진 칸이 있으면 그 표에 행이 있는 계정의 만 14세 미만 정리가 외래 키로 실패한다 — HISTORY 에 더하세요")
                .containsAll(blocking);
    }
}
