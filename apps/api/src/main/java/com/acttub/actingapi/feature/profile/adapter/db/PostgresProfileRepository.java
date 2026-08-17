package com.acttub.actingapi.feature.profile.adapter.db;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.ProfileRepository;
import com.acttub.actingapi.feature.profile.domain.Profile;
import com.acttub.actingapi.platform.schema.UserStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class PostgresProfileRepository implements ProfileRepository {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;

    PostgresProfileRepository(JdbcTemplate jdbc, TransactionTemplate transactions) {
        this.jdbc = jdbc;
        this.transactions = transactions;
    }

    @Override
    public Profile find(UUID userId) {
        List<Profile> rows = jdbc.query(
                "SELECT id,email,nickname,status::text FROM users WHERE id=?",
                (result, rowNumber) -> new Profile(
                        result.getObject("id", UUID.class),
                        result.getString("email"),
                        result.getString("nickname"),
                        status(result.getString("status"))),
                userId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    /**
     * 아는 어휘인지 확인하고 DB 값을 그대로 돌려준다.
     *
     * <p><b>Domain Model 이 문자열을 들되 느슨해지지는 않게 하는 자리다.</b> 열거형은
     * {@code jakarta.persistence} 를 끌고 있어 {@code domain} 으로 들일 수 없지만, 그렇다고
     * 어휘 밖 값을 통과시키면 재편이 실패 경로를 넓힌다 — 스키마를 먼저 넓히고 코드를 나중에
     * 좁히는 배포 순서에서 <b>DB 에 값이 먼저, 자바가 나중</b>은 실제로 일어난다. 종전처럼
     * 여기서 터지고 500 이 난다. ({@code practice} 가 검증 없이 문자열을 쓰는 것은 그쪽이
     * 재편 전부터 그랬기 때문이고, 이 넷은 열거형이었다.)
     */
    private static String status(String raw) {
        return UserStatus.valueOf(raw.toUpperCase(Locale.ROOT)).dbValue();
    }

    @Override
    public Profile updateNickname(UUID userId, String nickname) {
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
     * <p>⚠ <b>여기서 {@code user_identities}·{@code refresh_tokens} 를 함께 치는 것은 의도한
     * 것이다.</b> 그 두 테이블의 주인은 {@code auth} 지만, 파기의 원자성이 트랜잭션 하나를
     * 요구한다 — 포트로 갈라 두 도메인이 나눠 부르면 그 경계가 깨진다. 도메인 사이의 결합은
     * 아니다(이 파일은 {@code auth} 를 한 줄도 import 하지 않는다).
     *
     * <p>이미 탈퇴한 계정이면 <b>최초 탈퇴 시각을 유지</b>한다. 파기는 멱등하게 다시 돈다.
     */
    @Override
    public Profile deactivate(UUID userId) {
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
}
