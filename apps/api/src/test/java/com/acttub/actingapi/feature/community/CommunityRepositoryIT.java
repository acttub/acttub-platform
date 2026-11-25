package com.acttub.actingapi.feature.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.community.app.CommunityContentNotFound;
import com.acttub.actingapi.feature.community.app.CommunityImageRepository;
import com.acttub.actingapi.feature.community.app.CommunityImageRepository.PendingImage;
import com.acttub.actingapi.feature.community.app.CommunityRepository;
import com.acttub.actingapi.feature.community.app.CommunityRepository.PostWrite;
import com.acttub.actingapi.feature.community.app.DuplicateReport;
import com.acttub.actingapi.feature.community.app.InvalidImage;
import com.acttub.actingapi.feature.community.app.NotAuthor;
import com.acttub.actingapi.feature.community.app.Page;
import com.acttub.actingapi.feature.community.app.ReportingOwnContent;
import com.acttub.actingapi.feature.community.domain.CommunityComment;
import com.acttub.actingapi.feature.community.domain.CommunityPost;
import com.acttub.actingapi.feature.community.domain.PostImage;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/**
 * 게시판 저장소(글·댓글·좋아요·신고·차단과 사진 올리기 장부)가 내는 결과·잠금·경합·문장을 실제 PostgreSQL 에서 고정한다.
 * 저장소를 네이티브 SQL 에서 JPA 로 옮길 때 네이티브 구현에서 먼저 통과시킨 이 테스트가 그대로 통과해야 한다
 * (apps/api/CONTRACT.md §5-9).
 *
 * <p>HTTP 쪽 오류 코드·차단 가시성·커서 모양·익명 표시 이름과 좋아요·댓글 수의 경합은 {@link CommunityEndpointIT}·
 * {@link CommunityErrorContractIT}·{@link CommunityImageIT}, 익명 번호의 경합은 {@code AnonymousAliasAllocatorIT} 가 본다.
 * 여기서는 그 테스트가 밟지 않는 경계(같은 시각의 정렬, 가린 글·지운 글, 처리한 신고, 시한과 같은 시각), 잠금 세기,
 * 두 요청이 같은 행을 다툴 때의 결과, 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "COMMUNITY_IMAGE_SWEEP_ENABLED=false",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.community.CommunityRepositoryIT$Recorder"
})
class CommunityRepositoryIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    CommunityRepository community;

    @Autowired
    CommunityImageRepository images;

    @Autowired
    PlatformTransactionManager transactionManager;

    @Autowired
    AccountSecrets secrets;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users, account_cleanup_operations RESTART IDENTITY CASCADE");
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 포트 메서드마다 결과 ----

    @Test
    @DisplayName("listPosts·getPost: 같은 created_at 은 id 내림차순이고 커서는 그 다음부터다. 사진은 글마다 sort_order 순이고 붙은 것만 싣는다")
    void listingsOrderPostsAndCarryAttachedImagesInOrder() {
        UUID author = member();
        UUID viewer = member();
        post(author, id(1), "visible", now);
        post(author, id(2), "visible", now);
        post(author, id(3), "visible", now.minusSeconds(1));
        image(author, id(11), id(2), 1, now, now);
        image(author, id(12), id(2), 0, now, now);
        image(author, id(13), id(1), 0, now, now);
        image(author, id(14), null, null, now, now);

        Page<CommunityPost> first = community.listPosts(viewer, "free", null, 2);
        Page<CommunityPost> second = community.listPosts(viewer, null, first.nextCursor(), 2);

        assertThat(first.items()).extracting(CommunityPost::id).containsExactly(id(2), id(1));
        assertThat(first.items().getFirst().images()).containsExactly(
                new PostImage(id(12), key(id(12))), new PostImage(id(11), key(id(11))));
        assertThat(first.items().get(1).images()).containsExactly(new PostImage(id(13), key(id(13))));
        assertThat(first.nextCursor()).isNotNull();
        assertThat(second.items()).extracting(CommunityPost::id).containsExactly(id(3));
        assertThat(second.items().getFirst().images()).isEmpty();
        assertThat(second.nextCursor()).isNull();
        assertThat(community.getPost(id(2), viewer).images()).extracting(PostImage::id).containsExactly(id(12), id(11));
        assertThat(community.listPosts(viewer, "free", first.nextCursor(), 50).items())
                .extracting(CommunityPost::id).containsExactly(id(3));
    }

    @Test
    @DisplayName("createPost: 사진을 준 순서대로 0 부터 붙인다. 분류가 없거나 닫혔으면 CommunityContentNotFound, 붙일 수 없는 사진(남의 것·올라오지 않음·이미 붙음·없음·겹침)이 하나라도 있으면 InvalidImage 이고 글도 남지 않는다")
    void createPostAttachesImagesInTheGivenOrder() {
        UUID author = member();
        UUID other = member();
        image(author, id(21), null, null, now, now);
        image(author, id(22), null, null, now, now);
        image(other, id(23), null, null, now, now);
        image(author, id(24), null, null, now, null);
        image(author, id(25), null, null, now, now);

        CommunityPost created = community.createPost(author, "free", "제목", "본문", false, List.of(id(22), id(21)));

        assertThat(created.images()).containsExactly(new PostImage(id(22), key(id(22))), new PostImage(id(21), key(id(21))));
        assertThat(created.title()).isEqualTo("제목");
        assertThat(created.status()).isEqualTo("visible");
        assertThat(created.updatedAt()).isEqualTo(created.createdAt());
        assertThat(sortOrders(created.id())).containsExactly("21=1", "22=0");

        for (List<UUID> invalid : List.of(
                List.of(id(23)), List.of(id(24)), List.of(id(22)), List.of(UUID.randomUUID()), List.of(id(25), id(25)),
                List.of(id(25), id(23)))) {
            assertThatThrownBy(() -> community.createPost(author, "free", "안 됨", "본문", false, invalid))
                    .as(invalid.toString()).isInstanceOf(InvalidImage.class);
        }
        assertThat(count("community_posts")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT post_id IS NULL FROM community_post_images WHERE id=?", Boolean.class, id(25)))
                .isTrue();

        assertThatThrownBy(() -> community.createPost(author, "nope", "제목", "본문", false, List.of()))
                .isInstanceOf(CommunityContentNotFound.class);
        jdbc.update("""
                INSERT INTO community_categories(slug,name,sort_order,is_active) VALUES ('closed-repository-it','닫힘',99,false)
                ON CONFLICT (slug) DO NOTHING
                """);
        try {
            assertThatThrownBy(() -> community.createPost(author, "closed-repository-it", "제목", "본문", false, List.of()))
                    .isInstanceOf(CommunityContentNotFound.class);
        } finally {
            jdbc.update("DELETE FROM community_categories WHERE slug='closed-repository-it'");
        }
    }

    @Test
    @DisplayName("updatePost: updated_at 은 트랜잭션 시작 시각, created_at 은 그대로다. 사진 목록이 null 이면 사진은 그대로, 주면 빠진 행을 지우고 그 키를 한 장부에 올리며 남은 사진을 준 순서로 다시 매긴다")
    void updatePostReplacesImagesAndSchedulesTheDroppedKeys() {
        UUID author = member();
        post(author, id(1), "visible", now);
        image(author, id(31), id(1), 0, now, now);
        image(author, id(32), id(1), 1, now, now);
        image(author, id(33), id(1), 2, now, now);
        image(author, id(34), null, null, now, now);

        PostWrite kept = inTransaction(() -> {
            PostWrite write = community.updatePost(id(1), author, "새 제목", "새 본문", null);
            assertThat(jdbc.queryForObject("SELECT updated_at=now() FROM community_posts WHERE id=?", Boolean.class, id(1)))
                    .isTrue();
            return write;
        });
        assertThat(kept.cleanupOperationIds()).isEmpty();
        assertThat(kept.post().images()).extracting(PostImage::id).containsExactly(id(31), id(32), id(33));
        assertThat(kept.post().title()).isEqualTo("새 제목");
        assertThat(instant("SELECT created_at FROM community_posts WHERE id=?", id(1))).isEqualTo(now);

        PostWrite replaced = community.updatePost(id(1), author, "제목", "본문", List.of(id(33), id(34), id(31)));
        assertThat(replaced.post().images()).extracting(PostImage::id).containsExactly(id(33), id(34), id(31));
        assertThat(sortOrders(id(1))).containsExactly("31=2", "33=0", "34=1");
        assertThat(count("community_post_images")).isEqualTo(3);
        assertThat(replaced.cleanupOperationIds()).singleElement()
                .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactly(key(id(32))));

        PostWrite emptied = community.updatePost(id(1), author, "제목", "본문", List.of());
        assertThat(emptied.post().images()).isEmpty();
        assertThat(count("community_post_images")).isZero();
        assertThat(emptied.cleanupOperationIds()).singleElement().satisfies(operation -> assertThat(scheduledKeys(operation))
                .containsExactlyInAnyOrder(key(id(31)), key(id(33)), key(id(34))));
    }

    @Test
    @DisplayName("updatePost·deletePost: 없는 글·지운 글은 CommunityContentNotFound, 남의 글은 NotAuthor 다. 가린 글은 고치지 못하고 지울 수는 있다. 지우면 글 행은 deleted 로 남고 사진 행을 지워 장부에 올린다")
    void updateAndDeleteJudgeExistenceAndOwnership() {
        UUID author = member();
        UUID other = member();
        post(author, id(1), "visible", now);
        post(author, id(2), "hidden", now);
        post(author, id(3), "deleted", now);
        post(other, id(4), "visible", now);
        image(author, id(41), id(2), 0, now, now);
        image(author, id(42), id(2), 1, now, now);

        for (List<UUID> imageIds : java.util.Arrays.asList(null, List.<UUID>of())) {
            assertThatThrownBy(() -> community.updatePost(UUID.randomUUID(), author, "t", "b", imageIds))
                    .isInstanceOf(CommunityContentNotFound.class);
            assertThatThrownBy(() -> community.updatePost(id(3), author, "t", "b", imageIds))
                    .isInstanceOf(CommunityContentNotFound.class);
            assertThatThrownBy(() -> community.updatePost(id(2), author, "t", "b", imageIds))
                    .isInstanceOf(CommunityContentNotFound.class);
            assertThatThrownBy(() -> community.updatePost(id(4), author, "t", "b", imageIds))
                    .isInstanceOf(NotAuthor.class);
        }
        assertThatThrownBy(() -> community.deletePost(UUID.randomUUID(), author)).isInstanceOf(CommunityContentNotFound.class);
        assertThatThrownBy(() -> community.deletePost(id(3), author)).isInstanceOf(CommunityContentNotFound.class);
        assertThatThrownBy(() -> community.deletePost(id(4), author)).isInstanceOf(NotAuthor.class);
        assertThat(count("community_post_images")).isEqualTo(2);

        List<UUID> hidden = community.deletePost(id(2), author);
        assertThat(hidden).singleElement().satisfies(operation -> assertThat(scheduledKeys(operation))
                .containsExactlyInAnyOrder(key(id(41)), key(id(42))));
        assertThat(community.deletePost(id(1), author)).isEmpty();
        assertThat(jdbc.queryForList("SELECT status FROM community_posts ORDER BY id", String.class))
                .containsExactly("deleted", "deleted", "deleted", "visible");
        assertThat(count("community_post_images")).isZero();
    }

    @Test
    @DisplayName("incrementViewCount: 하나 올리고 updated_at 은 그대로다. 가리거나 지운 글도 올린다. 없는 글이면 아무 일도 없다")
    void incrementViewCountTouchesOnlyTheCounter() {
        UUID author = member();
        post(author, id(1), "visible", now);
        post(author, id(2), "hidden", now);
        post(author, id(3), "deleted", now);

        for (UUID post : List.of(id(1), id(2), id(3), id(1))) {
            community.incrementViewCount(post);
        }
        community.incrementViewCount(UUID.randomUUID());

        assertThat(jdbc.queryForList("SELECT view_count FROM community_posts ORDER BY id", Integer.class))
                .containsExactly(2, 1, 1);
        assertThat(jdbc.queryForList("SELECT updated_at FROM community_posts", OffsetDateTime.class))
                .allSatisfy(updated -> assertThat(updated.toInstant()).isEqualTo(now));
    }

    @Test
    @DisplayName("likePost·unlikePost: 다시 센 수를 돌려주고 저장한다. 같은 트랜잭션에서 다시 읽어도 그 수다. updated_at 은 그대로다")
    void likesReturnTheRecountedValueWithinTheTransaction() {
        UUID author = member();
        UUID fan = member();
        UUID other = member();
        post(author, id(1), "visible", now);
        jdbc.update("INSERT INTO community_post_likes(id,post_id,user_id) VALUES (?,?,?)", id(51), id(1), other);
        jdbc.update("UPDATE community_posts SET like_count=40 WHERE id=?", id(1));

        assertThat(inTransaction(() -> {
            int liked = community.likePost(id(1), fan);
            assertThat(likeCount(id(1))).isEqualTo(liked);
            return liked;
        })).isEqualTo(2);
        assertThat(community.likePost(id(1), fan)).isEqualTo(2);
        assertThat(inTransaction(() -> {
            int unliked = community.unlikePost(id(1), other);
            assertThat(likeCount(id(1))).isEqualTo(unliked);
            return unliked;
        })).isEqualTo(1);
        assertThat(community.unlikePost(id(1), other)).isEqualTo(1);
        assertThat(jdbc.queryForList("SELECT user_id FROM community_post_likes", UUID.class)).containsExactly(fan);
        assertThat(instant("SELECT updated_at FROM community_posts WHERE id=?", id(1))).isEqualTo(now);
    }

    @Test
    @DisplayName("createComment·deleteComment: 댓글 수를 하나씩 올리고 내리며 0 아래로 가지 않는다. 글의 updated_at 은 그대로다. 가리거나 지운 글에는 달 수 없고, 지운·없는 댓글은 CommunityContentNotFound, 남의 댓글은 NotAuthor, 가린 자기 댓글은 지울 수 있다")
    void commentsMoveTheCounterAndJudgeTheirTarget() {
        UUID author = member();
        UUID writer = member();
        post(author, id(1), "visible", now);
        post(author, id(2), "hidden", now);
        post(author, id(3), "deleted", now);

        CommunityComment created = community.createComment(id(1), writer, "댓글", false);
        assertThat(created.body()).isEqualTo("댓글");
        assertThat(created.postId()).isEqualTo(id(1));
        assertThat(created.status()).isEqualTo("visible");
        assertThat(commentCount(id(1))).isEqualTo(1);
        assertThatThrownBy(() -> community.createComment(id(2), writer, "댓글", false))
                .isInstanceOf(CommunityContentNotFound.class);
        assertThatThrownBy(() -> community.createComment(id(3), writer, "댓글", false))
                .isInstanceOf(CommunityContentNotFound.class);

        comment(id(1), writer, id(61), "hidden");
        comment(id(1), author, id(62), "visible");
        comment(id(1), writer, id(63), "deleted");
        jdbc.update("UPDATE community_posts SET comment_count=0 WHERE id=?", id(1));

        assertThatThrownBy(() -> community.deleteComment(id(62), writer)).isInstanceOf(NotAuthor.class);
        assertThatThrownBy(() -> community.deleteComment(id(63), writer)).isInstanceOf(CommunityContentNotFound.class);
        assertThatThrownBy(() -> community.deleteComment(UUID.randomUUID(), writer))
                .isInstanceOf(CommunityContentNotFound.class);
        community.deleteComment(id(61), writer);
        assertThat(commentCount(id(1))).as("0 아래로 가지 않는다").isZero();
        jdbc.update("UPDATE community_posts SET comment_count=5 WHERE id=?", id(1));
        community.deleteComment(created.id(), writer);
        assertThat(commentCount(id(1))).isEqualTo(4);
        assertThat(jdbc.queryForList("SELECT status FROM community_comments WHERE author_id=? ORDER BY id", String.class, writer))
                .containsExactlyInAnyOrder("deleted", "deleted", "deleted");
        assertThat(instant("SELECT updated_at FROM community_posts WHERE id=?", id(1))).isEqualTo(now);
    }

    @Test
    @DisplayName("createReport: 지운·없는 대상은 CommunityContentNotFound, 자기 것은 ReportingOwnContent, 같은 대상 두 번은 DuplicateReport 다. 처리 전 신고를 낸 서로 다른 세 사람이 모이면 가린다 — 처리한 신고는 세지 않고, 가려도 updated_at 은 그대로다. 가린 대상도 신고할 수 있다")
    void reportsHideTheTargetAfterThreePendingReporters() {
        UUID author = member();
        List<UUID> reporters = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            reporters.add(member());
        }
        post(author, id(1), "visible", now);
        post(author, id(2), "deleted", now);
        comment(id(1), author, id(71), "visible");

        assertThatThrownBy(() -> community.createReport(reporters.getFirst(), "post", id(2), "spam", null))
                .isInstanceOf(CommunityContentNotFound.class);
        assertThatThrownBy(() -> community.createReport(reporters.getFirst(), "comment", UUID.randomUUID(), "spam", null))
                .isInstanceOf(CommunityContentNotFound.class);
        assertThatThrownBy(() -> community.createReport(author, "post", id(1), "spam", null))
                .isInstanceOf(ReportingOwnContent.class);

        for (UUID reporter : reporters.subList(0, 2)) {
            jdbc.update("""
                    INSERT INTO community_reports(id,reporter_id,target_type,target_id,reason,status)
                    VALUES (gen_random_uuid(),?,'post',?,'spam','actioned')
                    """, reporter, id(1));
        }
        community.createReport(reporters.get(2), "post", id(1), "abuse", "상세");
        community.createReport(reporters.get(3), "post", id(1), "spam", null);
        assertThat(status("community_posts", id(1))).as("처리한 신고는 세지 않는다").isEqualTo("visible");
        assertThatThrownBy(() -> community.createReport(reporters.get(3), "post", id(1), "other", null))
                .isInstanceOf(DuplicateReport.class);
        community.createReport(reporters.get(4), "post", id(1), "spam", null);
        assertThat(status("community_posts", id(1))).isEqualTo("hidden");
        assertThat(instant("SELECT updated_at FROM community_posts WHERE id=?", id(1))).isEqualTo(now);
        community.createReport(reporters.get(5), "post", id(1), "spam", null);
        assertThat(status("community_posts", id(1))).isEqualTo("hidden");
        assertThat(jdbc.queryForMap("SELECT reason,detail,status FROM community_reports WHERE reporter_id=?", reporters.get(2)))
                .containsEntry("reason", "abuse").containsEntry("detail", "상세").containsEntry("status", "pending");

        for (UUID reporter : reporters.subList(0, 3)) {
            community.createReport(reporter, "comment", id(71), "spam", null);
        }
        assertThat(status("community_comments", id(71))).isEqualTo("hidden");
    }

    @Test
    @DisplayName("blockUser: 없는 사람은 CommunityContentNotFound 이고, 두 번 막아도 한 행이다. 탈퇴한 사람도 막을 수 있다")
    void blockUserKeepsOneRowPerPair() {
        UUID blocker = member();
        UUID blocked = member();
        UUID closed = member();
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", closed);

        assertThatThrownBy(() -> community.blockUser(blocker, UUID.randomUUID())).isInstanceOf(CommunityContentNotFound.class);
        community.blockUser(blocker, blocked);
        community.blockUser(blocker, blocked);
        community.blockUser(blocker, closed);

        assertThat(jdbc.queryForList("SELECT blocked_id FROM user_blocks WHERE blocker_id=?", UUID.class, blocker))
                .containsExactlyInAnyOrder(blocked, closed);
    }

    @Test
    @DisplayName("images.begin: 글에 붙지 않은 그 사람의 행만 세어 상한이면 거짓이다. 넣은 행의 created_at 은 넘긴 시각(마이크로초 반올림)이고 글·순서·올림은 비어 있다")
    void beginCountsOnlyTheUploadersUnattachedRows() {
        UUID uploader = member();
        UUID other = member();
        post(uploader, id(1), "visible", now);
        image(uploader, id(81), null, null, now, null);
        image(uploader, id(82), id(1), 0, now, now);
        image(other, id(83), null, null, now, null);
        image(other, id(84), null, null, now, null);
        Instant precise = now.plusNanos(123_456_789);

        assertThat(images.begin(pending(id(85), uploader, now.plusSeconds(600)), 2, precise)).isTrue();
        assertThat(images.begin(pending(id(86), uploader, now.plusSeconds(600)), 2, precise)).isFalse();

        assertThat(jdbc.queryForMap("""
                SELECT uploader_id,post_id,object_key,mime_type,size_bytes,sort_order,created_at,expires_at,uploaded_at
                FROM community_post_images WHERE id=?
                """, id(85)))
                .containsEntry("uploader_id", uploader).containsEntry("post_id", null).containsEntry("object_key", key(id(85)))
                .containsEntry("mime_type", "image/jpeg").containsEntry("size_bytes", 1000L).containsEntry("sort_order", null)
                .containsEntry("uploaded_at", null);
        assertThat(instant("SELECT created_at FROM community_post_images WHERE id=?", id(85)))
                .isEqualTo(now.plusNanos(123_457_000));
        assertThat(instant("SELECT expires_at FROM community_post_images WHERE id=?", id(85))).isEqualTo(now.plusSeconds(600));
        assertThat(count("community_post_images")).isEqualTo(5);
    }

    @Test
    @DisplayName("images.find·markUploaded: 남의 것·없는 것은 null 이다. 올림 표시는 처음 한 번만 적는다")
    void findAndMarkUploaded() {
        UUID uploader = member();
        UUID other = member();
        image(uploader, id(91), null, null, now, null);

        assertThat(images.find(uploader, id(91)))
                .isEqualTo(new PendingImage(id(91), uploader, null, key(id(91)), "image/jpeg", 1000L, now.plusSeconds(600), false));
        assertThat(images.find(other, id(91))).isNull();
        assertThat(images.find(uploader, UUID.randomUUID())).isNull();

        images.markUploaded(id(91), now.plusSeconds(5));
        images.markUploaded(id(91), now.plusSeconds(9));
        images.markUploaded(UUID.randomUUID(), now);

        assertThat(images.find(uploader, id(91)).uploaded()).isTrue();
        assertThat(instant("SELECT uploaded_at FROM community_post_images WHERE id=?", id(91))).isEqualTo(now.plusSeconds(5));
    }

    @Test
    @DisplayName("images.sweepUnattached: before 보다 먼저 만든 붙지 않은 행만 지운다(같은 시각은 남는다). 올린 사람마다 장부 하나이고, 올리기 시한이 아직이면 그 시한 뒤에 지운다")
    void sweepRemovesOnlyOldUnattachedRowsAndGroupsByUploader() {
        UUID first = member();
        UUID second = member();
        Instant before = now.minusSeconds(3600);
        post(first, id(1), "visible", now);
        image(first, id(101), null, null, before.minusSeconds(1), null);
        image(first, id(102), null, null, before.minusSeconds(2), now.minusSeconds(4000));
        image(first, id(103), null, null, before, null);
        image(first, id(104), id(1), 0, before.minusSeconds(60), before);
        imageExpiring(second, id(105), before.minusSeconds(1), now.plusSeconds(600));

        List<UUID> operations = images.sweepUnattached(before, now);

        assertThat(jdbc.queryForList("SELECT id FROM community_post_images ORDER BY id", UUID.class)).containsExactly(id(103), id(104));
        assertThat(operations).hasSize(2);
        Map<UUID, UUID> byUser = new java.util.HashMap<>();
        for (UUID operation : operations) {
            byUser.put(jdbc.queryForObject("SELECT user_id FROM account_cleanup_operations WHERE id=?", UUID.class, operation),
                    operation);
        }
        assertThat(scheduledKeys(byUser.get(first))).containsExactlyInAnyOrder(key(id(101)), key(id(102)));
        assertThat(nextAttempt(byUser.get(first))).isEqualTo(now);
        assertThat(scheduledKeys(byUser.get(second))).containsExactly(key(id(105)));
        assertThat(nextAttempt(byUser.get(second))).isEqualTo(now.plusSeconds(600));
        assertThat(images.sweepUnattached(before, now)).isEmpty();
    }

    // ---- 잠금 세기 ----

    @Test
    @DisplayName("글 행을 잡는 쓰기(사진을 바꾸는 고치기·지우기·좋아요·좋아요 취소·익명 댓글·신고)는 FOR UPDATE 다 — 바깥 연결의 FOR KEY SHARE 뒤에서 기다린다")
    void postRowWritesTakeForUpdate() throws Exception {
        UUID author = member();
        UUID other = member();
        post(author, id(1), "visible", now);
        post(author, id(2), "visible", now);
        List<Supplier<?>> writes = List.of(
                () -> community.updatePost(id(1), author, "고침", "본문", List.of()),
                () -> community.likePost(id(1), other),
                () -> community.unlikePost(id(1), other),
                () -> community.createComment(id(1), other, "익명", true),
                () -> {
                    community.createReport(other, "post", id(1), "spam", null);
                    return null;
                },
                () -> community.deletePost(id(2), author));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            for (int i = 0; i < writes.size(); i++) {
                UUID post = i == writes.size() - 1 ? id(2) : id(1);
                lock(probe, "SELECT 1 FROM community_posts WHERE id=? FOR KEY SHARE", post);
                Supplier<?> write = writes.get(i);
                Future<?> waiting = pool.submit(write::get);
                String statement = awaitWaiting("community_posts").toLowerCase(Locale.ROOT);
                probe.rollback();
                waiting.get(20, TimeUnit.SECONDS);
                assertThat(statement).as("쓰기 %d", i).startsWith("select").contains("for update").doesNotContain("no key");
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(status("community_posts", id(1))).isEqualTo("visible");
        assertThat(status("community_posts", id(2))).isEqualTo("deleted");
    }

    @Test
    @DisplayName("글 행의 칸만 고치는 쓰기(사진을 두는 고치기·조회수·댓글 수)는 FOR NO KEY UPDATE 세기다 — FOR KEY SHARE 는 지나고 FOR SHARE 뒤에서는 기다린다")
    void postColumnUpdatesLockLikeANonKeyUpdate() throws Exception {
        UUID author = member();
        UUID other = member();
        post(author, id(1), "visible", now);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lock(probe, "SELECT 1 FROM community_posts WHERE id=? FOR KEY SHARE", id(1));
            pool.submit(() -> community.updatePost(id(1), author, "막히지 않음", "본문", null)).get(20, TimeUnit.SECONDS);
            pool.submit(() -> community.incrementViewCount(id(1))).get(20, TimeUnit.SECONDS);
            CommunityComment comment = pool.submit(() -> community.createComment(id(1), other, "댓글", false))
                    .get(20, TimeUnit.SECONDS);
            pool.submit(() -> {
                community.deleteComment(comment.id(), other);
                return null;
            }).get(20, TimeUnit.SECONDS);
            probe.rollback();

            lock(probe, "SELECT 1 FROM community_posts WHERE id=? FOR SHARE", id(1));
            Future<?> view = pool.submit(() -> community.incrementViewCount(id(1)));
            String waiting = awaitWaiting("community_posts").toLowerCase(Locale.ROOT);
            probe.rollback();
            view.get(20, TimeUnit.SECONDS);
            assertThat(waiting).startsWith("update community_posts");
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForMap("SELECT title,view_count,comment_count FROM community_posts WHERE id=?", id(1)))
                .containsEntry("title", "막히지 않음").containsEntry("view_count", 2).containsEntry("comment_count", 0);
    }

    @Test
    @DisplayName("댓글 지우기는 댓글 행을 FOR UPDATE 로 잡는다 — 바깥 연결의 FOR KEY SHARE 뒤에서 기다린다")
    void deleteCommentTakesForUpdateOnTheComment() throws Exception {
        UUID author = member();
        post(author, id(1), "visible", now);
        comment(id(1), author, id(61), "visible");
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lock(probe, "SELECT 1 FROM community_comments WHERE id=? FOR KEY SHARE", id(61));
            Future<?> delete = pool.submit(() -> community.deleteComment(id(61), author));
            String waiting = awaitWaiting("community_comments").toLowerCase(Locale.ROOT);
            probe.rollback();
            delete.get(20, TimeUnit.SECONDS);
            assertThat(waiting).startsWith("select").contains("for update").doesNotContain("no key");
        } finally {
            pool.shutdownNow();
        }
        assertThat(status("community_comments", id(61))).isEqualTo("deleted");
    }

    @Test
    @DisplayName("사진 행을 붙이거나 지우는 쓰기(글 쓰기의 붙이기, 고치기에서 뺀 사진, 글 지우기, 오래된 올리기 치우기)는 그 행을 FOR UPDATE 세기로 잡는다. 올림 표시는 FOR NO KEY UPDATE 세기다")
    void imageRowWritesTakeForUpdateStrength() throws Exception {
        UUID author = member();
        post(author, id(1), "visible", now);
        post(author, id(2), "visible", now);
        image(author, id(111), null, null, now, now);
        image(author, id(112), id(1), 0, now, now);
        image(author, id(113), id(2), 0, now, now);
        image(author, id(114), null, null, now.minusSeconds(7200), null);
        image(author, id(115), null, null, now, null);
        record Case(UUID row, Supplier<?> write) {
        }
        List<Case> cases = List.of(
                new Case(id(111), () -> community.createPost(author, "free", "붙임", "본문", false, List.of(id(111)))),
                new Case(id(112), () -> community.updatePost(id(1), author, "뺌", "본문", List.of())),
                new Case(id(113), () -> community.deletePost(id(2), author)),
                new Case(id(114), () -> images.sweepUnattached(now.minusSeconds(3600), now)));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            for (Case each : cases) {
                lock(probe, "SELECT 1 FROM community_post_images WHERE id=? FOR KEY SHARE", each.row());
                Future<?> waiting = pool.submit(each.write()::get);
                awaitWaiting("community_post_images");
                probe.rollback();
                waiting.get(20, TimeUnit.SECONDS);
            }
            lock(probe, "SELECT 1 FROM community_post_images WHERE id=? FOR KEY SHARE", id(115));
            pool.submit(() -> images.markUploaded(id(115), now)).get(20, TimeUnit.SECONDS);
            probe.rollback();
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT id FROM community_post_images ORDER BY id", UUID.class))
                .containsExactly(id(111), id(115));
    }

    @Test
    @DisplayName("올리기 시작은 다른 기능(auth)의 users 행을 FOR UPDATE 로 잡는다")
    void beginLocksTheUploaderRow() throws Exception {
        UUID uploader = member();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lock(probe, "SELECT 1 FROM users WHERE id=? FOR KEY SHARE", uploader);
            Future<Boolean> begin = pool.submit(() -> images.begin(pending(id(121), uploader, now.plusSeconds(600)), 20, now));
            String waiting = awaitWaiting("from users").toLowerCase(Locale.ROOT);
            probe.rollback();
            assertThat(begin.get(20, TimeUnit.SECONDS)).isTrue();
            assertThat(waiting).contains("for update").doesNotContain("no key");
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("글 행을 잡은 동안(사진을 바꾸는 고치기·지우기) 그 글에 사진 행이 새로 붙지 못한다 — 붙이는 UPDATE 가 FK 로 거는 FOR KEY SHARE 가 기다린다")
    void aHeldPostLockKeepsNewImageRowsOut() throws Exception {
        UUID author = member();
        post(author, id(1), "visible", now);
        post(author, id(2), "visible", now);
        image(author, id(131), id(1), 0, now, now);
        image(author, id(132), null, null, now, now);
        image(author, id(133), null, null, now, now);
        record Case(UUID post, UUID intruder, Supplier<?> write) {
        }
        List<Case> cases = List.of(
                new Case(id(1), id(132), () -> community.updatePost(id(1), author, "고침", "본문", List.of(id(131)))),
                new Case(id(2), id(133), () -> community.deletePost(id(2), author)));
        for (Case each : cases) {
            CountDownLatch held = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);
            ExecutorService pool = Executors.newFixedThreadPool(2);
            try {
                Future<?> holder = pool.submit(() -> inTransaction(() -> {
                    Object result = each.write().get();
                    held.countDown();
                    await(release);
                    return result;
                }));
                await(held);
                Future<Integer> intruder = pool.submit(() -> {
                    try (Connection outside = probe()) {
                        outside.setAutoCommit(true);
                        try (PreparedStatement attach = outside.prepareStatement(
                                "UPDATE community_post_images SET post_id=?, sort_order=4 WHERE id=?")) {
                            attach.setObject(1, each.post());
                            attach.setObject(2, each.intruder());
                            return attach.executeUpdate();
                        }
                    }
                });
                assertThat(awaitWaiting("update community_post_images set post_id").toLowerCase(Locale.ROOT))
                        .startsWith("update community_post_images");
                release.countDown();
                holder.get(20, TimeUnit.SECONDS);
                assertThat(intruder.get(20, TimeUnit.SECONDS)).isEqualTo(1);
            } finally {
                pool.shutdownNow();
            }
        }
        assertThat(sortOrders(id(1))).containsExactly("131=0", "132=4");
        assertThat(sortOrders(id(2))).containsExactly("133=4");
    }

    // ---- 경합 ----

    @Test
    @DisplayName("같은 사진을 두 글 쓰기가 함께 붙이면 뒤의 것이 사진 행에서 기다렸다가 InvalidImage 를 받는다. 글은 하나만 남는다")
    void twoPostsRacingForTheSameImage() throws Exception {
        UUID author = member();
        image(author, id(141), null, null, now, now);
        Race<CommunityPost, CommunityPost> race = race(
                () -> community.createPost(author, "free", "먼저", "본문", false, List.of(id(141))),
                () -> community.createPost(author, "free", "나중", "본문", false, List.of(id(141))),
                "community_post_images");

        assertThat(race.first().title()).isEqualTo("먼저");
        assertThat(race.secondFailure()).isInstanceOf(InvalidImage.class);
        assertThat(jdbc.queryForList("SELECT title FROM community_posts", String.class)).containsExactly("먼저");
        assertThat(jdbc.queryForObject("SELECT post_id FROM community_post_images WHERE id=?", UUID.class, id(141)))
                .isEqualTo(race.first().id());
    }

    @Test
    @DisplayName("오래된 올리기 치우기와 글 쓰기의 붙이기가 같은 사진을 다투면 먼저 잡은 쪽이 이긴다 — 붙이기가 먼저면 치우기는 그 행을 건너뛰고, 치우기가 먼저면 붙이기는 InvalidImage 다")
    void sweepAndAttachRacingForTheSameImage() throws Exception {
        UUID author = member();
        Instant old = now.minusSeconds(7200);
        image(author, id(151), null, null, old, old);
        image(author, id(152), null, null, old, old);

        Race<CommunityPost, List<UUID>> attachFirst = race(
                () -> community.createPost(author, "free", "붙임", "본문", false, List.of(id(151))),
                () -> images.sweepUnattached(now.minusSeconds(3600), now),
                "community_post_images");
        assertThat(attachFirst.second()).as("152 만 치운다").hasSize(1);
        assertThat(jdbc.queryForList("SELECT id FROM community_post_images", UUID.class)).containsExactly(id(151));

        image(author, id(153), null, null, old, old);
        Race<List<UUID>, CommunityPost> sweepFirst = race(
                () -> images.sweepUnattached(now.minusSeconds(3600), now),
                () -> community.createPost(author, "free", "늦음", "본문", false, List.of(id(153))),
                "community_post_images");
        assertThat(sweepFirst.first()).hasSize(1);
        assertThat(sweepFirst.secondFailure()).isInstanceOf(InvalidImage.class);
        assertThat(jdbc.queryForList("SELECT id FROM community_post_images", UUID.class)).containsExactly(id(151));
        assertThat(count("community_posts")).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 글의 사진을 두 고치기가 함께 바꾸면 뒤의 것이 글 행에서 기다렸다가 앞의 결과 위에서 바꾼다. 뺀 사진은 저마다 장부에 오른다")
    void twoImageReplacementsAtOnce() throws Exception {
        UUID author = member();
        post(author, id(1), "visible", now);
        image(author, id(161), id(1), 0, now, now);
        image(author, id(162), id(1), 1, now, now);
        image(author, id(163), null, null, now, now);

        Race<PostWrite, PostWrite> race = race(
                () -> community.updatePost(id(1), author, "먼저", "본문", List.of(id(162), id(163))),
                () -> community.updatePost(id(1), author, "나중", "본문", List.of(id(163))),
                "community_posts");

        assertThat(race.first().post().images()).extracting(PostImage::id).containsExactly(id(162), id(163));
        assertThat(race.second().post().images()).extracting(PostImage::id).containsExactly(id(163));
        assertThat(scheduledKeys(race.first().cleanupOperationIds().getFirst())).containsExactly(key(id(161)));
        assertThat(scheduledKeys(race.second().cleanupOperationIds().getFirst())).containsExactly(key(id(162)));
        assertThat(sortOrders(id(1))).containsExactly("163=0");
        assertThat(jdbc.queryForObject("SELECT title FROM community_posts WHERE id=?", String.class, id(1))).isEqualTo("나중");
    }

    @Test
    @DisplayName("같은 댓글을 두 요청이 함께 지우면 뒤의 것이 댓글 행에서 기다렸다가 CommunityContentNotFound 를 받는다. 댓글 수는 한 번만 준다")
    void twoDeletesOfTheSameComment() throws Exception {
        UUID author = member();
        post(author, id(1), "visible", now);
        comment(id(1), author, id(171), "visible");
        jdbc.update("UPDATE community_posts SET comment_count=2 WHERE id=?", id(1));

        Race<Object, Object> race = race(
                () -> {
                    community.deleteComment(id(171), author);
                    return null;
                },
                () -> {
                    community.deleteComment(id(171), author);
                    return null;
                },
                "community_comments");

        assertThat(race.secondFailure()).isInstanceOf(CommunityContentNotFound.class);
        assertThat(commentCount(id(1))).isEqualTo(1);
    }

    @Test
    @DisplayName("셋째와 넷째 신고가 함께 들어오면 뒤의 것이 대상 행에서 기다렸다가 앞의 신고까지 세어 가린다")
    void twoReportsCrossingTheThresholdTogether() throws Exception {
        UUID author = member();
        UUID first = member();
        UUID second = member();
        UUID third = member();
        post(author, id(1), "visible", now);
        community.createReport(first, "post", id(1), "spam", null);

        race(
                () -> {
                    community.createReport(second, "post", id(1), "spam", null);
                    assertThat(status("community_posts", id(1))).as("앞의 것만으로는 둘이다").isEqualTo("visible");
                    return null;
                },
                () -> {
                    community.createReport(third, "post", id(1), "spam", null);
                    return null;
                },
                "community_posts");

        assertThat(status("community_posts", id(1))).isEqualTo("hidden");
    }

    @Test
    @DisplayName("조회수를 두 요청이 함께 올리면 뒤의 것이 기다렸다가 둘 다 센다")
    void twoViewsAtOnceAreBothCounted() throws Exception {
        UUID author = member();
        post(author, id(1), "visible", now);

        race(() -> {
            community.incrementViewCount(id(1));
            return null;
        }, () -> {
            community.incrementViewCount(id(1));
            return null;
        }, "update community_posts");

        assertThat(jdbc.queryForObject("SELECT view_count FROM community_posts WHERE id=?", Integer.class, id(1))).isEqualTo(2);
    }

    @Test
    @DisplayName("글 지우기와 좋아요가 함께 오면 좋아요가 글 행에서 기다렸다가 CommunityContentNotFound 를 받는다")
    void likeWaitingBehindADelete() throws Exception {
        UUID author = member();
        UUID fan = member();
        post(author, id(1), "visible", now);

        Race<List<UUID>, Integer> race = race(
                () -> community.deletePost(id(1), author),
                () -> community.likePost(id(1), fan),
                "community_posts");

        assertThat(race.secondFailure()).isInstanceOf(CommunityContentNotFound.class);
        assertThat(count("community_post_likes")).isZero();
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류")
    void eachPortMethodSendsTheseStatements() {
        UUID author = member();
        UUID other = member();
        image(author, id(181), null, null, now, now);
        image(author, id(182), null, null, now, now);
        String posts = "select community_posts";
        String imageRead = "select community_post_images";
        String postLock = "select community_posts for update";
        String imageLock = "select community_post_images for update";

        assertThat(statementsOf(() -> community.listCategories())).containsExactly("select community_categories");
        assertThat(statementsOf(() -> community.listPosts(other, null, null, 20))).as("글이 없으면 사진을 읽지 않는다")
                .containsExactly(posts);
        CommunityPost[] created = new CommunityPost[1];
        assertThat(statementsOf(() -> created[0] = community.createPost(author, "free", "제목", "본문", false,
                List.of(id(181), id(182)))))
                .containsExactly("select community_categories", "insert community_posts", imageLock,
                        "update community_post_images", "update community_post_images", posts, imageRead);
        UUID post = created[0].id();
        assertThat(statementsOf(() -> community.createPost(author, "free", "제목", "본문", false, List.of())))
                .containsExactly("select community_categories", "insert community_posts", posts, imageRead);
        assertThat(statementsOf(() -> community.listPosts(other, null, null, 20))).containsExactly(posts, imageRead);
        assertThat(statementsOf(() -> community.getPost(post, other))).containsExactly(posts, imageRead);
        assertThat(statementsOf(() -> community.updatePost(post, author, "고침", "본문", null)))
                .containsExactly(posts, "update community_posts", posts, imageRead);
        assertThat(statementsOf(() -> community.updatePost(post, author, "고침", "본문", List.of(id(182), id(181)))))
                .as("뺀 사진이 없을 때")
                .containsExactly(postLock, "update community_posts", imageLock, "delete community_post_images returning",
                        "update community_post_images", "update community_post_images", "update community_post_images",
                        posts, imageRead);
        assertThat(statementsOf(() -> community.updatePost(post, author, "고침", "본문", List.of(id(181)))))
                .as("뺀 사진이 있을 때")
                .containsExactly(postLock, "update community_posts", imageLock, "delete community_post_images returning",
                        "update community_post_images", "update community_post_images",
                        "insert account_cleanup_operations", posts, imageRead);
        assertThat(statementsOf(() -> {
            community.incrementViewCount(post);
            return null;
        })).containsExactly("update community_posts");
        assertThat(statementsOf(() -> community.likePost(post, other)))
                .containsExactly(postLock, "insert community_post_likes returning", "update community_posts returning");
        assertThat(statementsOf(() -> community.unlikePost(post, other)))
                .containsExactly(postLock, "delete community_post_likes", "update community_posts returning");
        CommunityComment[] comment = new CommunityComment[1];
        assertThat(statementsOf(() -> comment[0] = community.createComment(post, other, "댓글", false)))
                .containsExactly(posts, imageRead, "insert community_comments", "update community_posts",
                        "select community_comments", "select community_anonymous_aliases");
        assertThat(statementsOf(() -> community.createComment(post, other, "익명", true)))
                .as("익명 번호를 처음 받을 때")
                .containsExactly(posts, imageRead, postLock, "select community_anonymous_aliases",
                        "select community_anonymous_aliases", "insert community_anonymous_aliases returning",
                        "insert community_comments", "update community_posts", "select community_comments",
                        "select community_anonymous_aliases");
        assertThat(statementsOf(() -> community.createComment(post, other, "익명", true)))
                .as("받은 번호가 있을 때")
                .containsExactly(posts, imageRead, postLock, "select community_anonymous_aliases",
                        "insert community_comments", "update community_posts", "select community_comments",
                        "select community_anonymous_aliases");
        assertThat(statementsOf(() -> community.listComments(post, other, null, 20)))
                .containsExactly(posts, imageRead, "select community_comments", "select community_anonymous_aliases");
        assertThat(statementsOf(() -> {
            community.deleteComment(comment[0].id(), other);
            return null;
        })).containsExactly("select community_comments for update", "update community_comments", "update community_posts");
        assertThat(statementsOf(() -> {
            community.createReport(other, "post", post, "spam", null);
            return null;
        })).containsExactly(posts, "insert community_reports", postLock, "update community_posts");
        assertThat(statementsOf(() -> {
            assertThatThrownBy(() -> community.createReport(author, "comment", comment[0].id(), "spam", null))
                    .isInstanceOf(CommunityContentNotFound.class);
            return null;
        })).as("지운 댓글은 신고하지 못한다").containsExactly("select community_comments");
        assertThat(statementsOf(() -> {
            community.blockUser(author, other);
            return null;
        })).containsExactly("select users", "insert user_blocks returning");
        assertThat(statementsOf(() -> community.deletePost(post, author)))
                .containsExactly(postLock, "update community_posts", "delete community_post_images returning",
                        "insert account_cleanup_operations");

        assertThat(statementsOf(() -> images.begin(pending(id(183), author, now.plusSeconds(600)), 20, now)))
                .containsExactly("select users for update", "count community_post_images", "insert community_post_images");
        assertThat(statementsOf(() -> images.begin(pending(id(184), author, now.plusSeconds(600)), 1, now)))
                .as("상한일 때").containsExactly("select users for update", "count community_post_images");
        assertThat(statementsOf(() -> images.find(author, id(183)))).containsExactly(imageRead);
        assertThat(statementsOf(() -> {
            images.markUploaded(id(183), now);
            return null;
        })).containsExactly("update community_post_images");
        assertThat(statementsOf(() -> images.sweepUnattached(now.plusSeconds(1), now)))
                .containsExactly("delete community_post_images returning", "insert account_cleanup_operations");
        assertThat(statementsOf(() -> images.sweepUnattached(now.plusSeconds(1), now))).as("치울 것이 없을 때")
                .containsExactly("delete community_post_images returning");
    }

    // ---- 도움 ----

    private static final Pattern CTE = Pattern.compile("^with \\w+ as \\( ?(insert into|update|delete from) (\\w+)\\b.*");
    private static final Pattern COUNT = Pattern.compile("^select count\\(.*?\\) from (\\w+)\\b.*");
    private static final Pattern INSERT = Pattern.compile("^insert into (\\w+)\\b.*");
    private static final Pattern UPDATE = Pattern.compile("^update (\\w+)\\b.*");
    private static final Pattern DELETE = Pattern.compile("^delete from (\\w+)\\b.*");

    /** 문장을 "<종류> <표>[ 덧붙임]" 으로 줄인다. 별칭·열 목록·매개변수 표기는 두 구현이 달라 견주지 않는다. */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        Matcher matcher;
        if ((matcher = CTE.matcher(text)).matches()) {
            return matcher.group(1).split(" ")[0] + " " + matcher.group(2) + " returning";
        }
        if ((matcher = COUNT.matcher(text)).matches()) {
            return "count " + matcher.group(1);
        }
        if (text.startsWith("select ")) {
            return "select " + topLevelFrom(text) + (text.contains(" for update") ? " for update" : "");
        }
        if ((matcher = INSERT.matcher(text)).matches()) {
            return "insert " + matcher.group(1) + (text.contains(" on conflict") ? " on conflict" : "");
        }
        if ((matcher = UPDATE.matcher(text)).matches()) {
            return "update " + matcher.group(1);
        }
        if ((matcher = DELETE.matcher(text)).matches()) {
            return "delete " + matcher.group(1);
        }
        return text;
    }

    /** 괄호 밖에 있는 첫 FROM 뒤의 표. 고르는 칸 안의 EXISTS(SELECT … FROM …) 에 속지 않는다. */
    private static String topLevelFrom(String text) {
        int depth = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth--;
            } else if (depth == 0 && text.startsWith(" from ", i)) {
                Matcher table = Pattern.compile("^ from (\\w+)").matcher(text.substring(i));
                if (table.find()) {
                    return table.group(1);
                }
            }
        }
        return text;
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(CommunityRepositoryIT::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    /** 앞의 것이 트랜잭션 안에서 먼저 끝나고 잡은 채 기다리는 동안 뒤의 것이 {@code waitingOn} 을 담은 문장에서 기다린다. */
    private <A, B> Race<A, B> race(Supplier<A> firstCall, Supplier<B> secondCall, String waitingOn) throws Exception {
        CountDownLatch held = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<A> first = pool.submit(() -> inTransaction(() -> {
                A result = firstCall.get();
                held.countDown();
                await(release);
                return result;
            }));
            await(held);
            Future<B> second = pool.submit(secondCall::get);
            awaitWaiting(waitingOn);
            release.countDown();
            A firstResult = first.get(20, TimeUnit.SECONDS);
            try {
                return new Race<>(firstResult, second.get(20, TimeUnit.SECONDS), null);
            } catch (java.util.concurrent.ExecutionException failed) {
                return new Race<>(firstResult, null, failed.getCause());
            }
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    private record Race<A, B>(A first, B second, Throwable secondFailure) {
    }

    private <T> T inTransaction(Supplier<T> body) {
        return new TransactionTemplate(transactionManager).execute(status -> body.get());
    }

    private UUID member() {
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", userId);
        return userId;
    }

    /** 자유 게시판의 글. 제목 "제목<n>". created_at·updated_at 은 같은 값이다. */
    private void post(UUID author, UUID postId, String status, Instant createdAt) {
        jdbc.update("""
                INSERT INTO community_posts(id,category_id,author_id,title,body,anonymous,status,created_at,updated_at)
                VALUES (?,(SELECT id FROM community_categories WHERE slug='free'),?,?,'본문',false,?,?,?)
                """, postId, author, "제목" + number(postId), status, utc(createdAt), utc(createdAt));
    }

    private void comment(UUID postId, UUID author, UUID commentId, String status) {
        jdbc.update("""
                INSERT INTO community_comments(id,post_id,author_id,body,anonymous,status,created_at,updated_at)
                VALUES (?,?,?,'댓글',false,?,?,?)
                """, commentId, postId, author, status, utc(now), utc(now));
    }

    /** 올리기 시한은 만든 뒤 10분이다. */
    private void image(UUID uploader, UUID imageId, UUID postId, Integer sortOrder, Instant createdAt, Instant uploadedAt) {
        jdbc.update("""
                INSERT INTO community_post_images(
                    id,uploader_id,post_id,object_key,mime_type,size_bytes,sort_order,created_at,expires_at,uploaded_at)
                VALUES (?,?,?,?,'image/jpeg',1000,?,?,?,?)
                """, imageId, uploader, postId, key(imageId), sortOrder, utc(createdAt), utc(createdAt.plusSeconds(600)),
                uploadedAt == null ? null : utc(uploadedAt));
    }

    private void imageExpiring(UUID uploader, UUID imageId, Instant createdAt, Instant expiresAt) {
        jdbc.update("""
                INSERT INTO community_post_images(id,uploader_id,object_key,mime_type,size_bytes,created_at,expires_at)
                VALUES (?,?,?,'image/jpeg',1000,?,?)
                """, imageId, uploader, key(imageId), utc(createdAt), utc(expiresAt));
    }

    private PendingImage pending(UUID imageId, UUID uploader, Instant expiresAt) {
        return new PendingImage(imageId, uploader, null, key(imageId), "image/jpeg", 1000L, expiresAt, false);
    }

    private static String key(UUID imageId) {
        return "community/test/" + imageId;
    }

    private static UUID id(int n) {
        return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(n));
    }

    private static int number(UUID id) {
        return Integer.parseInt(id.toString().substring(24));
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    private Instant instant(String sql, Object... args) {
        return jdbc.queryForObject(sql, OffsetDateTime.class, args).toInstant();
    }

    private String status(String table, UUID id) {
        return jdbc.queryForObject("SELECT status FROM " + table + " WHERE id=?", String.class, id);
    }

    private int likeCount(UUID postId) {
        return jdbc.queryForObject("SELECT like_count FROM community_posts WHERE id=?", Integer.class, postId);
    }

    private int commentCount(UUID postId) {
        return jdbc.queryForObject("SELECT comment_count FROM community_posts WHERE id=?", Integer.class, postId);
    }

    /** "<id 끝 자리>=<sort_order>", 그 글에 붙은 사진을 id 순으로. */
    private List<String> sortOrders(UUID postId) {
        return jdbc.queryForList("SELECT id, sort_order FROM community_post_images WHERE post_id=? ORDER BY id", postId)
                .stream()
                .map(row -> number((UUID) row.get("id")) + "=" + row.get("sort_order"))
                .toList();
    }

    private List<String> scheduledKeys(UUID operation) {
        String payload = jdbc.queryForObject(
                "SELECT payload_encrypted FROM account_cleanup_operations WHERE id=?", String.class, operation);
        return List.of(JSON.readValue(secrets.decrypt(payload), String[].class));
    }

    private Instant nextAttempt(UUID operation) {
        return instant("SELECT next_attempt_at FROM account_cleanup_operations WHERE id=?", operation);
    }

    private Connection probe() throws Exception {
        Connection connection = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
        connection.setAutoCommit(false);
        return connection;
    }

    private static void lock(Connection probe, String sql, UUID id) throws Exception {
        try (PreparedStatement statement = probe.prepareStatement(sql)) {
            statement.setObject(1, id);
            statement.execute();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(20, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exc);
        }
    }

    /** 잠금을 기다리는 문장 가운데 {@code fragment} 를 담은 것. 공백·줄바꿈은 하나의 공백으로 본다. */
    private String awaitWaiting(String fragment) throws Exception {
        Instant deadline = Instant.now().plusSeconds(10);
        while (Instant.now().isBefore(deadline)) {
            List<String> waiting = jdbc.queryForList("""
                    SELECT regexp_replace(query, '\\s+', ' ', 'g') FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                    """, String.class).stream()
                    .filter(query -> query.toLowerCase(Locale.ROOT).contains(fragment))
                    .toList();
            if (!waiting.isEmpty()) {
                return waiting.getFirst().strip();
            }
            Thread.sleep(10);
        }
        throw new AssertionError("'" + fragment + "' 를 담은 문장이 잠금 뒤에서 기다리지 않았다");
    }
}
