package com.acttub.actingapi.feature.push.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import com.acttub.actingapi.feature.push.app.AppVersion;
import com.acttub.actingapi.feature.push.app.PracticeReminderRepository;
import com.acttub.actingapi.feature.push.app.PushTarget;
import com.acttub.actingapi.feature.push.app.ReminderContent;
import com.acttub.actingapi.feature.push.app.ReminderCopy;
import com.acttub.actingapi.feature.push.app.ReminderTextTrimmer;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 개인화 연습 알림의 저장소(SOMA-720, V47). 읽기만 하는 질의 몇 개와, 보낼 자리를 선점하는 한 문장이다.
 *
 * <p>연습 사건은 저녁 리마인드와 같은 목록에서 대본(scripts)만 뺀 것이다 — 대본을 올리는 것은 연습이 아니다.
 * 코칭 = 영상·연습·코치 메시지, 리딩 = 리딩 회차·리딩 녹음·암기 상태.
 */
@Repository
class PostgresPracticeReminderRepository implements PracticeReminderRepository {
    private static final Pattern ENDS_WITH_QUESTION = Pattern.compile("[?\uFF1F][\\s\"'\u201D\u2019)\\]]*$");
    private static final int SCRIPT_LIMIT = 5;
    private static final int LINE_LIMIT = 2000;

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresPracticeReminderRepository(EntityManager entityManager, PlatformTransactionManager manager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(manager);
        this.transaction.setReadOnly(false);
    }

    @Override
    public List<Candidate> candidates(LocalDate today, Instant windowStart, String minimumAppVersion) {
        return transaction.execute(status -> {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    WITH events AS NOT MATERIALIZED (
                        SELECT user_id, created_at AS at, 'coaching' AS kind FROM videos
                        UNION ALL SELECT user_id, created_at, 'coaching' FROM practices
                        UNION ALL SELECT p.user_id, m.created_at, 'coaching' FROM coach_messages m
                          JOIN coach_conversations c ON c.id=m.conversation_id
                          JOIN practices p ON p.id=c.practice_id
                        UNION ALL SELECT user_id, started_at, 'reading' FROM reading_sessions
                        UNION ALL SELECT user_id, updated_at, 'reading' FROM reading_sessions
                        UNION ALL SELECT user_id, created_at, 'reading' FROM reading_recordings
                        UNION ALL SELECT user_id, updated_at, 'reading' FROM line_memorization
                    ),
                    eligible AS (
                        SELECT u.id AS user_id, u.created_at AS signup_at
                        FROM users u
                        JOIN user_profiles profile ON profile.user_id=u.id
                        WHERE u.status='active' AND profile.notify_evening_reminder
                          AND EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id=u.id)
                    ),
                    recent AS MATERIALIZED (
                        SELECT e.user_id, e.at, e.kind
                        FROM events e JOIN eligible el ON el.user_id=e.user_id
                        WHERE e.at>=:windowStart
                    ),
                    last_day AS (
                        SELECT user_id, max((at AT TIME ZONE 'Asia/Seoul')::date) AS d FROM recent GROUP BY user_id
                    ),
                    practiced AS (
                        SELECT ld.user_id, ld.d AS last_day,
                               (SELECT min(r.at) FROM recent r WHERE r.user_id=ld.user_id
                                  AND (r.at AT TIME ZONE 'Asia/Seoul')::date=ld.d) AS first_at,
                               (SELECT r.kind FROM recent r WHERE r.user_id=ld.user_id ORDER BY r.at DESC LIMIT 1) AS last_kind
                        FROM last_day ld
                    ),
                    never AS (
                        SELECT el.user_id, (el.signup_at AT TIME ZONE 'Asia/Seoul')::date AS last_day,
                               el.signup_at AS first_at, CAST(NULL AS text) AS last_kind
                        FROM eligible el
                        WHERE el.signup_at>=:windowStart
                          AND NOT EXISTS (SELECT 1 FROM events e WHERE e.user_id=el.user_id)
                    ),
                    pick AS (SELECT * FROM practiced UNION ALL SELECT * FROM never)
                    SELECT pick.user_id, to_char(pick.last_day,'YYYY-MM-DD') AS last_day, pick.first_at, pick.last_kind,
                           (pick.last_kind IS NULL) AS never_practiced,
                           (pick.last_day=CAST(:today AS date)) AS practiced_today,
                           COALESCE((SELECT string_agg(s.slot,',') FROM practice_reminder_sends s
                                     WHERE s.user_id=pick.user_id AND s.day=CAST(:today AS date)),'') AS sent_slots
                    FROM pick
                    ORDER BY pick.user_id
                    """, Tuple.class)
                    .setParameter("windowStart", windowStart.atOffset(ZoneOffset.UTC))
                    .setParameter("today", today.toString()));
            if (rows.isEmpty()) return List.<Candidate>of();

            List<UUID> ids = rows.stream().map(row -> row.get("user_id", UUID.class)).toList();
            List<Tuple> tokenRows = list(entityManager.createNativeQuery("""
                    SELECT user_id, token, locale, app_version FROM push_tokens
                    WHERE user_id IN (:ids) ORDER BY user_id, created_at
                    """, Tuple.class).setParameter("ids", ids));
            Map<UUID, List<PushTarget>> targets = new LinkedHashMap<>();
            for (Tuple row : tokenRows) {
                if (!AppVersion.atLeast(row.get("app_version", String.class), minimumAppVersion)) continue;
                targets.computeIfAbsent(row.get("user_id", UUID.class), ignored -> new ArrayList<>())
                        .add(new PushTarget(row.get("token", String.class), row.get("locale", String.class)));
            }

            List<Candidate> candidates = new ArrayList<>();
            for (Tuple row : rows) {
                UUID userId = row.get("user_id", UUID.class);
                List<PushTarget> userTargets = targets.get(userId);
                if (userTargets == null) continue;
                Set<String> sent = new HashSet<>();
                String sentSlots = row.get("sent_slots", String.class);
                if (sentSlots != null && !sentSlots.isBlank()) sent.addAll(List.of(sentSlots.split(",")));
                candidates.add(new Candidate(userId, List.copyOf(userTargets), row.get("first_at", Instant.class),
                        LocalDate.parse(row.get("last_day", String.class)),
                        row.get("never_practiced", Boolean.class), "reading".equals(row.get("last_kind", String.class)),
                        row.get("practiced_today", Boolean.class), Set.copyOf(sent)));
            }
            return List.copyOf(candidates);
        });
    }

    /**
     * 앱의 연속 일수와 같은 기준의 날: 노트가 생긴 코칭 회차(회차 생성일), 끝까지 읽은 리딩 회차(시작일), 올린 참여작.
     * 숨긴 기록도 센다 — 앱은 기기에 쌓은 연습일을 합치므로 숨겨도 그날은 남는다.
     */
    @Override
    public Set<LocalDate> countedPracticeDays(UUID userId, LocalDate since) {
        return transaction.execute(status -> {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    SELECT DISTINCT to_char(x.d,'YYYY-MM-DD') AS day FROM (
                        SELECT (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS d FROM practices p
                        WHERE p.user_id=:userId AND p.created_at>=:since
                          AND EXISTS (SELECT 1 FROM coach_conversations c JOIN coach_notes n ON n.conversation_id=c.id
                                      WHERE c.practice_id=p.id)
                        UNION ALL
                        SELECT (s.started_at AT TIME ZONE 'Asia/Seoul')::date FROM reading_sessions s
                        WHERE s.user_id=:userId AND s.status='completed' AND s.started_at>=:since
                        UNION ALL
                        SELECT (e.created_at AT TIME ZONE 'Asia/Seoul')::date FROM challenge_entries e
                        WHERE e.user_id=:userId AND e.created_at>=:since AND e.deleted_at IS NULL AND e.status<>'deleted'
                    ) x
                    """, Tuple.class)
                    .setParameter("userId", userId)
                    .setParameter("since", since.atStartOfDay(com.acttub.actingapi.feature.push.app.PracticeReminderPolicy.SEOUL)
                            .toInstant().atOffset(ZoneOffset.UTC)));
            Set<LocalDate> days = new HashSet<>();
            for (Tuple row : rows) days.add(LocalDate.parse(row.get("day", String.class)));
            return Set.copyOf(days);
        });
    }

    @Override
    public ReminderContent.Resume latestOpenQuestion(UUID userId) {
        return transaction.execute(status -> {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    SELECT c.id AS conversation_id, p.id AS practice_id, c.status, p.title AS practice_title,
                           EXISTS (SELECT 1 FROM practice_reminder_sends r WHERE r.conversation_id=c.id) AS reminded,
                           last.role AS last_role, last.text AS last_text,
                           EXISTS (SELECT 1 FROM coach_messages a WHERE a.conversation_id=c.id AND a.role='actor') AS answered
                    FROM coach_conversations c
                    JOIN practices p ON p.id=c.practice_id
                    JOIN practices root ON root.id=p.root_id
                    CROSS JOIN LATERAL (
                        SELECT m.role, m.text FROM coach_messages m
                        WHERE m.conversation_id=c.id ORDER BY m.turn_index DESC LIMIT 1
                    ) last
                    WHERE p.user_id=:userId AND root.hidden_at IS NULL AND p.legacy_hidden_at IS NULL
                    ORDER BY c.created_at DESC
                    LIMIT 1
                    """, Tuple.class).setParameter("userId", userId));
            if (rows.isEmpty()) return null;
            Tuple row = rows.getFirst();
            String text = row.get("last_text", String.class);
            if (Boolean.TRUE.equals(row.get("reminded", Boolean.class)) || !"open".equals(row.get("status", String.class)) || !"ai".equals(row.get("last_role", String.class))
                    || text == null || !ENDS_WITH_QUESTION.matcher(text.strip()).find()) {
                return null;
            }
            UUID practiceId = row.get("practice_id", UUID.class);
            return new ReminderContent.Resume(row.get("conversation_id", UUID.class), practiceId,
                    row.get("answered", Boolean.class), text, sensitive(userId, row.get("practice_title", String.class)));
        });
    }

    /** 가장 최근의 (대체 문구가 아닌) 노트가 다음 촬영 지시가 있는 action 일 때만 돌려준다. 숨긴 묶음은 제외한다. */
    @Override
    public ReminderContent.Homework latestHomework(UUID userId) {
        return transaction.execute(status -> {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    SELECT p.id AS practice_id, p.title AS practice_title, n.kind, n.next_take
                    FROM coach_notes n
                    JOIN coach_conversations c ON c.id=n.conversation_id
                    JOIN practices p ON p.id=c.practice_id
                    JOIN practices root ON root.id=p.root_id
                    WHERE p.user_id=:userId AND root.hidden_at IS NULL AND p.legacy_hidden_at IS NULL
                      AND n.fallback=false
                    ORDER BY n.created_at DESC
                    LIMIT 1
                    """, Tuple.class).setParameter("userId", userId));
            if (rows.isEmpty()) return null;
            Tuple row = rows.getFirst();
            String nextTake = row.get("next_take", String.class);
            if (!"action".equals(row.get("kind", String.class)) || nextTake == null || nextTake.isBlank()) return null;
            return new ReminderContent.Homework(row.get("practice_id", UUID.class), nextTake,
                    sensitive(userId, row.get("practice_title", String.class)));
        });
    }

    /**
     * 잠금 화면에서 지울 말. 연습(practices)에는 대본 연결이 없어 그 연습의 대본을 정확히 알 수 없다.
     * 연습 제목과, 이 회원이 최근 만지거나 올린 대본 다섯 개의 제목·인물 이름·대사 줄을 모두 후보로 쓴다.
     */
    private List<String> sensitive(UUID userId, String practiceTitle) {
        List<UUID> scriptIds = new ArrayList<>();
        List<String> titles = new ArrayList<>();
        titles.add(practiceTitle);
        for (Tuple row : list(entityManager.createNativeQuery("""
                SELECT id, title FROM scripts WHERE user_id=:userId ORDER BY updated_at DESC LIMIT :limit
                """, Tuple.class).setParameter("userId", userId).setParameter("limit", SCRIPT_LIMIT))) {
            scriptIds.add(row.get("id", UUID.class));
            titles.add(row.get("title", String.class));
        }
        if (scriptIds.isEmpty()) return ReminderTextTrimmer.sensitiveTerms(titles, List.of(), List.of());
        List<String> names = new ArrayList<>();
        for (Tuple row : list(entityManager.createNativeQuery(
                "SELECT name FROM script_characters WHERE script_id IN (:ids)", Tuple.class)
                .setParameter("ids", scriptIds))) {
            names.add(row.get("name", String.class));
        }
        List<String> lines = new ArrayList<>();
        for (Tuple row : list(entityManager.createNativeQuery("""
                SELECT text FROM script_lines WHERE script_id IN (:ids) AND char_length(text)>=6 LIMIT :limit
                """, Tuple.class).setParameter("ids", scriptIds).setParameter("limit", LINE_LIMIT))) {
            lines.add(row.get("text", String.class));
        }
        return ReminderTextTrimmer.sensitiveTerms(titles, names, lines);
    }

    @Override
    public UUID latestPendingVideo(UUID userId, Instant since) {
        return transaction.execute(status -> firstId(entityManager.createNativeQuery("""
                SELECT v.id FROM videos v
                WHERE v.user_id=:userId AND v.purged_at IS NULL AND v.created_at>=:since
                  AND NOT EXISTS (SELECT 1 FROM practices p WHERE p.video_id=v.id)
                  AND NOT EXISTS (SELECT 1 FROM challenge_entries e WHERE e.video_id=v.id)
                ORDER BY v.created_at DESC, v.id DESC
                LIMIT 1
                """, Tuple.class).setParameter("userId", userId).setParameter("since", since.atOffset(ZoneOffset.UTC))));
    }

    @Override
    public UUID latestUnreadScript(UUID userId, Instant since) {
        return transaction.execute(status -> firstId(entityManager.createNativeQuery("""
                SELECT s.id FROM scripts s
                WHERE s.user_id=:userId AND s.created_at>=:since AND s.source<>'sample'
                  AND NOT EXISTS (SELECT 1 FROM reading_sessions r WHERE r.script_id=s.id)
                ORDER BY s.created_at DESC, s.id DESC
                LIMIT 1
                """, Tuple.class).setParameter("userId", userId).setParameter("since", since.atOffset(ZoneOffset.UTC))));
    }

    private static UUID firstId(jakarta.persistence.Query query) {
        List<Tuple> rows = list(query);
        return rows.isEmpty() ? null : rows.getFirst().get("id", UUID.class);
    }

    @Override
    public Map<String, Integer> sentCountsByKind(UUID userId, LocalDate since) {
        return transaction.execute(status -> {
            Map<String, Integer> counts = new HashMap<>();
            for (Tuple row : list(entityManager.createNativeQuery("""
                    SELECT kind, count(*) AS n FROM practice_reminder_sends
                    WHERE user_id=:userId AND day>=CAST(:since AS date) GROUP BY kind
                    """, Tuple.class).setParameter("userId", userId).setParameter("since", since.toString()))) {
                counts.put(row.get("kind", String.class), row.get("n", Number.class).intValue());
            }
            return Map.copyOf(counts);
        });
    }

    @Override
    public Map<String, LocalDate> recentTemplates(UUID userId, LocalDate since) {
        return transaction.execute(status -> {
            Map<String, LocalDate> used = new HashMap<>();
            for (Tuple row : list(entityManager.createNativeQuery("""
                    SELECT template_id, to_char(max(day),'YYYY-MM-DD') AS day FROM practice_reminder_sends
                    WHERE user_id=:userId AND day>=CAST(:since AS date) GROUP BY template_id
                    """, Tuple.class).setParameter("userId", userId).setParameter("since", since.toString()))) {
                used.put(row.get("template_id", String.class), LocalDate.parse(row.get("day", String.class)));
            }
            return Map.copyOf(used);
        });
    }

    @Override
    public boolean claim(UUID userId, LocalDate day, ReminderCopy copy) {
        List<Tuple> inserted = transaction.execute(status -> list(entityManager.createNativeQuery("""
                WITH claimed AS (
                    INSERT INTO practice_reminder_sends(user_id,day,slot,kind,skipped_days,template_id,conversation_id)
                    VALUES (:userId,CAST(:day AS date),:slot,:kind,:skipped,:templateId,CAST(:conversationId AS uuid))
                    ON CONFLICT DO NOTHING
                    RETURNING user_id
                )
                SELECT user_id FROM claimed
                """, Tuple.class)
                .setParameter("userId", userId).setParameter("day", day.toString())
                .setParameter("slot", copy.kind().slot()).setParameter("kind", copy.kind().wire())
                .setParameter("conversationId", copy.conversationId() == null ? null : copy.conversationId().toString())
                .setParameter("skipped", copy.skippedDays()).setParameter("templateId", copy.templateId())));
        return inserted != null && !inserted.isEmpty();
    }
}
