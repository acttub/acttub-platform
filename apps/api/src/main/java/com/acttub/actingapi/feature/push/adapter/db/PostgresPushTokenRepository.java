package com.acttub.actingapi.feature.push.adapter.db;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.push.app.PushTokenRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class PostgresPushTokenRepository implements PushTokenRepository {
    private final JdbcTemplate jdbc;

    PostgresPushTokenRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * 토큰 기준 upsert. 같은 폰에 다른 계정이 로그인하면 소유자가 바뀌는 것이 맞다 —
     * 이전 계정으로 온 알림이 새 사용자의 폰에 뜨는 것이 이 테이블이 막아야 할 사고다.
     */
    @Override
    public void register(UUID userId, String token, String platform) {
        jdbc.update("""
                INSERT INTO push_tokens (user_id, token, platform)
                VALUES (?, ?, ?)
                ON CONFLICT (token)
                DO UPDATE SET user_id = EXCLUDED.user_id,
                              platform = EXCLUDED.platform,
                              updated_at = now()
                """, userId, token, platform);
    }

    @Override
    public void unregister(UUID userId, String token) {
        jdbc.update("DELETE FROM push_tokens WHERE user_id = ? AND token = ?", userId, token);
    }

    @Override
    public List<String> tokensForSessionOwner(UUID sessionId) {
        return jdbc.queryForList("""
                SELECT pt.token
                FROM push_tokens pt
                JOIN practice_sessions ps ON ps.user_id = pt.user_id
                WHERE ps.id = ?
                ORDER BY pt.created_at
                """, String.class, sessionId);
    }
}
