package com.acttub.actingapi.profile;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.domain.UserStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class ProfileStore {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;

    ProfileStore(JdbcTemplate jdbc, TransactionTemplate transactions) {
        this.jdbc = jdbc;
        this.transactions = transactions;
    }

    ProfileRow find(UUID userId) {
        List<ProfileRow> rows = jdbc.query(
                "SELECT id,email,nickname,status::text FROM users WHERE id=?",
                (result, rowNumber) -> new ProfileRow(
                        result.getObject("id", UUID.class),
                        result.getString("email"),
                        result.getString("nickname"),
                        UserStatus.valueOf(result.getString("status").toUpperCase(Locale.ROOT))),
                userId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    ProfileRow updateNickname(UUID userId, String nickname) {
        return transactions.execute(status -> {
            int updated = jdbc.update(
                    "UPDATE users SET nickname=?,updated_at=now() WHERE id=?",
                    nickname,
                    userId);
            return updated == 0 ? null : find(userId);
        });
    }

    /**
     * 탈퇴 처리 (`db/store.py:PostgresStore.deactivate_user`).
     *
     * <p>행을 지우지 않는다 — 커뮤니티 글·연습 기록이 {@code user_id} 를 참조하므로 지우면
     * 남의 글타래가 깨진다. 대신 개인을 식별하는 것(이메일·닉네임·identity)을 전부 파기하고
     * refresh 토큰을 끊는다. <b>상태 전환·파기·토큰 폐기를 한 트랜잭션에 묶는다</b> — 나누면
     * 중간 실패 시 "탈퇴했는데 refresh 는 살아 있는" 계정이 남는다.
     *
     * <p>이미 탈퇴한 계정이면 <b>최초 탈퇴 시각을 유지</b>한다. 파기는 멱등하게 다시 돈다.
     */
    ProfileRow deactivate(UUID userId) {
        return transactions.execute(status -> {
            List<String> current = jdbc.queryForList(
                    "SELECT status::text FROM users WHERE id=? FOR UPDATE",
                    String.class,
                    userId);
            if (current.isEmpty()) {
                return null;
            }
            if (!"deactivated".equals(current.getFirst())) {
                jdbc.update("""
                        UPDATE users
                        SET status='deactivated'::user_status_t,
                            deactivated_at=now(),
                            updated_at=now()
                        WHERE id=?
                        """, userId);
            }
            jdbc.update("UPDATE users SET email=NULL,nickname=NULL WHERE id=?", userId);
            jdbc.update("DELETE FROM user_identities WHERE user_id=?", userId);
            jdbc.update("""
                    UPDATE refresh_tokens
                    SET revoked_at=now()
                    WHERE user_id=? AND revoked_at IS NULL
                    """, userId);
            return find(userId);
        });
    }

    record ProfileRow(UUID id, String email, String nickname, UserStatus status) {
    }
}
