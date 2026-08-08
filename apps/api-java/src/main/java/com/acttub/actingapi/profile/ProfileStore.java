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

    record ProfileRow(UUID id, String email, String nickname, UserStatus status) {
    }
}
