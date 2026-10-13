package com.acttub.actingapi.feature.push.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.acttub.actingapi.feature.push.app.AppVersion;
import com.acttub.actingapi.feature.push.app.EveningReminderRepository;
import com.acttub.actingapi.feature.push.app.ReminderTarget;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class PostgresEveningReminderRepository implements EveningReminderRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresEveningReminderRepository(EntityManager entityManager, PlatformTransactionManager manager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(manager);
    }

    @Override
    public List<ReminderTarget> claimTargets(LocalDate day, Instant dayStart, Instant dayEnd,
            Instant recentSince, String minimumAppVersion) {
        return transaction.execute(status -> {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    WITH activity AS (
                        SELECT user_id, created_at AS occurred_at FROM videos
                        UNION ALL SELECT user_id, created_at FROM practices
                        UNION ALL SELECT p.user_id, m.created_at FROM coach_messages m
                          JOIN coach_conversations c ON c.id=m.conversation_id
                          JOIN practices p ON p.id=c.practice_id
                        UNION ALL SELECT user_id, created_at FROM scripts
                        UNION ALL SELECT user_id, started_at FROM reading_sessions
                        UNION ALL SELECT user_id, updated_at FROM reading_sessions
                        UNION ALL SELECT user_id, created_at FROM reading_recordings
                        UNION ALL SELECT user_id, updated_at FROM line_memorization
                    )
                    SELECT push.user_id,push.token,push.locale,push.app_version
                    FROM push_tokens push
                    JOIN users u ON u.id=push.user_id AND u.status='active'
                    JOIN user_profiles profile ON profile.user_id=push.user_id
                    WHERE profile.notify_evening_reminder
                      AND EXISTS (SELECT 1 FROM activity a WHERE a.user_id=push.user_id AND a.occurred_at>=:recentSince)
                      AND NOT EXISTS (SELECT 1 FROM activity a WHERE a.user_id=push.user_id
                                      AND a.occurred_at>=:dayStart AND a.occurred_at<:dayEnd)
                    ORDER BY push.user_id,push.created_at
                    """, Tuple.class)
                    .setParameter("recentSince", recentSince.atOffset(ZoneOffset.UTC))
                    .setParameter("dayStart", dayStart.atOffset(ZoneOffset.UTC))
                    .setParameter("dayEnd", dayEnd.atOffset(ZoneOffset.UTC)));

            var byUser = new LinkedHashMap<UUID, List<ReminderTarget>>();
            for (Tuple row : rows) {
                if (!AppVersion.atLeast(row.get("app_version", String.class), minimumAppVersion)) continue;
                UUID userId = row.get("user_id", UUID.class);
                byUser.computeIfAbsent(userId, ignored -> new ArrayList<>())
                        .add(new ReminderTarget(userId, row.get("token", String.class), row.get("locale", String.class)));
            }
            List<ReminderTarget> claimed = new ArrayList<>();
            byUser.forEach((userId, targets) -> {
                List<Tuple> inserted = list(entityManager.createNativeQuery("""
                        WITH claimed AS (
                            INSERT INTO evening_reminder_sends(user_id,day)
                            VALUES (:userId,:day)
                            ON CONFLICT DO NOTHING
                            RETURNING user_id
                        )
                        SELECT user_id FROM claimed
                        """, Tuple.class).setParameter("userId", userId).setParameter("day", day));
                if (!inserted.isEmpty()) claimed.addAll(targets);
            });
            return List.copyOf(claimed);
        });
    }

    @Override
    public Map<UUID, NextTake> latestNextTakes(Collection<UUID> userIds, Instant since) {
        if (userIds.isEmpty()) return Map.of();
        return transaction.execute(status -> {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    SELECT DISTINCT ON (p.user_id) p.user_id, p.id AS practice_id, n.next_take
                    FROM coach_notes n
                    JOIN coach_conversations c ON c.id=n.conversation_id
                    JOIN practices p ON p.id=c.practice_id
                    WHERE p.user_id IN (:userIds)
                      AND p.hidden_at IS NULL
                      AND n.created_at>=:since
                    ORDER BY p.user_id, n.created_at DESC
                    """, Tuple.class)
                    .setParameter("userIds", List.copyOf(userIds))
                    .setParameter("since", since.atOffset(ZoneOffset.UTC)));
            var latest = new LinkedHashMap<UUID, NextTake>();
            for (Tuple row : rows) {
                String text = row.get("next_take", String.class);
                if (text == null || text.isBlank()) continue;
                latest.put(row.get("user_id", UUID.class), new NextTake(row.get("practice_id", UUID.class), text));
            }
            return Map.copyOf(latest);
        });
    }
}
