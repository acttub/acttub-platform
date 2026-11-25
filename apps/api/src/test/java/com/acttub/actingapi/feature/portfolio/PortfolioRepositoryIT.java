package com.acttub.actingapi.feature.portfolio;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.portfolio.app.PortfolioRepository;
import com.acttub.actingapi.feature.portfolio.app.PortfolioRepository.PendingPhoto;
import com.acttub.actingapi.feature.portfolio.app.PortfolioRepository.PhotoSlot;
import com.acttub.actingapi.feature.portfolio.domain.Portfolio;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/**
 * 포트폴리오 저장소가 내는 결과·잠금·경합·문장을 실제 PostgreSQL 에서 고정한다. 저장소를 네이티브 SQL 에서 JPA 로 옮길 때
 * 네이티브 구현에서 먼저 통과시킨 이 테스트가 그대로 통과했다(apps/api/CONTRACT.md §5-9). 문장 테스트만 달라졌다 —
 * {@code RETURNING} 을 나눈 네 곳(경력 고치기·공유는 다시 읽기, 사진 지우기·시한 지난 올리기 치우기는 잠가 읽고 id 로 지우기)이다.
 *
 * <p>HTTP 쪽 값 검증·사유 코드·공개 조회·탈퇴 뒤 쓰기·정리 장부의 재시도는 {@link AccountPortfolioIT} 와
 * {@code AccountWritesAndPhotoCleanupIT}·{@code AccountWithdrawIT} 가 본다. 여기서는 그 테스트가 밟지 않는 같은 순서의 정렬,
 * 시한 경계, 남의 행, 시각의 정밀도, 계정 상태를 보지 않는 연산, 잠금 세기, 두 요청이 같은 자리를 다툴 때의 결과, 포트
 * 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.portfolio.PortfolioRepositoryIT$Recorder"
})
class PortfolioRepositoryIT {

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
    PortfolioRepository portfolios;

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
    @DisplayName("find: 행이 없으면 EMPTY 다. 경력은 sort_order·created_at·id 순, 사진은 올리기가 끝난 것만 sort_order·uploaded_at·id 순이고 남의 것은 없다")
    void findOrdersCreditsAndPhotosAndSkipsPendingOnes() {
        UUID owner = member();
        UUID other = member();
        assertThat(portfolios.find(owner)).isEqualTo(Portfolio.EMPTY);
        assertThat(count("portfolios")).as("읽기는 행을 만들지 않는다").isZero();

        jdbc.update("INSERT INTO portfolios(user_id,intro,share_enabled,share_slug) VALUES (?,'소개',true,'slug-find')", owner);
        row(other);
        credit(owner, id(11), 1, now);
        credit(owner, id(12), 0, now.plusSeconds(1));
        credit(owner, id(14), 0, now);
        credit(owner, id(13), 0, now);
        credit(other, id(15), 0, now.minusSeconds(60));
        photo(owner, id(21), 0, now, now.plusSeconds(1));
        photo(owner, id(22), 0, now, now);
        photo(owner, id(23), 1, now, now);
        photo(owner, id(24), null, now.plusSeconds(600), null);
        photo(owner, id(25), 0, now, now);
        photo(other, id(26), 0, now, now);

        Portfolio found = portfolios.find(owner);

        assertThat(found.intro()).isEqualTo("소개");
        assertThat(found.share()).isEqualTo(new Portfolio.Share(true, "slug-find"));
        assertThat(found.credits()).extracting(Portfolio.Credit::id).containsExactly(id(13), id(14), id(12), id(11));
        assertThat(found.credits().getFirst()).isEqualTo(new Portfolio.Credit(id(13), "작품13", "역할13", 2024, "musical"));
        assertThat(found.photos()).containsExactly(
                new Portfolio.Photo(id(22), key(id(22))),
                new Portfolio.Photo(id(25), key(id(25))),
                new Portfolio.Photo(id(21), key(id(21))),
                new Portfolio.Photo(id(23), key(id(23))));
        assertThat(portfolios.find(other)).isEqualTo(new Portfolio(null,
                List.of(new Portfolio.Credit(id(15), "작품15", "역할15", 2024, "musical")),
                List.of(new Portfolio.Photo(id(26), key(id(26)))),
                new Portfolio.Share(false, null)));
    }

    @Test
    @DisplayName("saveIntro: 행이 없으면 만들고 소개글을 적는다. null 은 지운다. updated_at 은 트랜잭션 시작 시각이고 created_at 은 그대로다")
    void saveIntroCreatesTheRowOnceAndStampsTheTransactionTime() {
        UUID owner = member();

        portfolios.saveIntro(owner, "첫 소개글");
        OffsetDateTime created = jdbc.queryForObject("SELECT created_at FROM portfolios WHERE user_id=?", OffsetDateTime.class, owner);
        Boolean stampedNow = inTransaction(() -> {
            portfolios.saveIntro(owner, null);
            return jdbc.queryForObject("SELECT updated_at=now() FROM portfolios WHERE user_id=?", Boolean.class, owner);
        });

        assertThat(stampedNow).isTrue();
        assertThat(jdbc.queryForMap("SELECT intro,share_enabled,share_slug,created_at FROM portfolios WHERE user_id=?", owner))
                .containsEntry("intro", null).containsEntry("share_enabled", false).containsEntry("share_slug", null);
        assertThat(jdbc.queryForObject("SELECT created_at FROM portfolios WHERE user_id=?", OffsetDateTime.class, owner))
                .isEqualTo(created);
        assertThat(count("portfolios")).isEqualTo(1);
    }

    @Test
    @DisplayName("활성이 아니거나 없는 계정: 행을 잡는 쓰기는 OwnerNotActive 이고 아무것도 적지 않는다. 경력 고치기·지우기와 사진 지우기는 계정 상태를 보지 않는다")
    void writesThatLockTheOwnerRefuseAnInactiveAccount() {
        UUID closed = member();
        UUID missing = UUID.randomUUID();
        row(closed);
        credit(closed, id(1), 0, now);
        photo(closed, id(2), null, now.plusSeconds(600), null);
        photo(closed, id(3), 0, now, now);
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", closed);

        for (UUID owner : List.of(closed, missing)) {
            List<Runnable> writes = List.of(
                    () -> portfolios.saveIntro(owner, "소개"),
                    () -> portfolios.addCredit(owner, "작품", "역할", 2024, "film", 50),
                    () -> portfolios.orderCredits(owner, List.of(id(1))),
                    () -> portfolios.beginPhoto(owner, pending(id(9), now.plusSeconds(600)), 10, now),
                    () -> portfolios.completePhoto(owner, id(2), now),
                    () -> portfolios.orderPhotos(owner, List.of(id(3))),
                    () -> portfolios.share(owner, true, "slug-closed"));
            for (Runnable write : writes) {
                assertThatThrownBy(write::run).isInstanceOf(PortfolioRepository.OwnerNotActive.class);
            }
        }
        assertThat(count("portfolios")).as("없는 계정의 행을 만들지 않는다").isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT intro,share_enabled FROM portfolios WHERE user_id=?", closed))
                .containsEntry("intro", null).containsEntry("share_enabled", false);
        assertThat(count("portfolio_photos")).isEqualTo(2);

        assertThat(portfolios.updateCredit(closed, id(1), "고친 작품", null, null, null)).isNotNull();
        assertThat(portfolios.deleteCredit(closed, id(1))).isTrue();
        assertThat(portfolios.deletePhoto(closed, id(3), now)).hasSize(1);
        assertThat(count("portfolio_credits")).isZero();
        assertThat(count("portfolio_photos")).isEqualTo(1);
    }

    @Test
    @DisplayName("addCredit: 그 회원의 가장 큰 sort_order 다음에 붙인다(남의 것은 세지 않는다). 상한에 닿으면 null 이고 적지 않는다")
    void addCreditAppendsAfterTheLargestOrderAndStopsAtTheLimit() {
        UUID owner = member();
        UUID other = member();
        row(other);
        credit(other, id(90), 7, now);

        Portfolio.Credit first = portfolios.addCredit(owner, "햄릿", "햄릿", 2024, "play", 3);
        jdbc.update("UPDATE portfolio_credits SET sort_order=5 WHERE id=?", first.id());
        Portfolio.Credit second = portfolios.addCredit(owner, "갈매기", "트레플료프", 2025, "film", 3);
        Portfolio.Credit third = portfolios.addCredit(owner, "광고", "모델", 2023, "ad", 3);

        assertThat(first).isEqualTo(new Portfolio.Credit(first.id(), "햄릿", "햄릿", 2024, "play"));
        assertThat(jdbc.queryForList("SELECT sort_order FROM portfolio_credits WHERE user_id=? ORDER BY sort_order",
                Integer.class, owner)).containsExactly(5, 6, 7);
        assertThat(jdbc.queryForMap("SELECT title,role,year,kind,updated_at=created_at AS fresh FROM portfolio_credits WHERE id=?",
                second.id()))
                .containsEntry("title", "갈매기").containsEntry("role", "트레플료프").containsEntry("year", 2025)
                .containsEntry("kind", "film").containsEntry("fresh", true);
        assertThat(third.kind()).isEqualTo("ad");

        assertThat(portfolios.addCredit(owner, "넘침", "넘침", 2024, "play", 3)).isNull();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM portfolio_credits WHERE user_id=?", Integer.class, owner))
                .isEqualTo(3);
    }

    @Test
    @DisplayName("updateCredit: null 인 항목은 그대로 두고 저장된 행을 낸다. 남의 것·없는 것은 null 이고 바꾸지 않는다. updated_at 은 트랜잭션 시작 시각이다")
    void updateCreditChangesOnlyTheGivenFields() {
        UUID owner = member();
        UUID other = member();
        row(owner);
        row(other);
        credit(owner, id(1), 0, now);
        credit(other, id(2), 0, now);

        assertThat(portfolios.updateCredit(owner, id(1), "새 작품", null, null, null))
                .isEqualTo(new Portfolio.Credit(id(1), "새 작품", "역할1", 2024, "musical"));
        Portfolio.Credit all = inTransaction(() -> {
            Portfolio.Credit changed = portfolios.updateCredit(owner, id(1), null, "새 역할", 2020, "drama");
            assertThat(jdbc.queryForObject("SELECT updated_at=now() FROM portfolio_credits WHERE id=?", Boolean.class, id(1)))
                    .isTrue();
            return changed;
        });
        assertThat(all).isEqualTo(new Portfolio.Credit(id(1), "새 작품", "새 역할", 2020, "drama"));
        assertThat(portfolios.updateCredit(owner, id(1), null, null, null, null))
                .isEqualTo(new Portfolio.Credit(id(1), "새 작품", "새 역할", 2020, "drama"));

        assertThat(portfolios.updateCredit(owner, id(2), "남의 것", null, null, null)).isNull();
        assertThat(portfolios.updateCredit(owner, UUID.randomUUID(), "없는 것", null, null, null)).isNull();
        assertThat(jdbc.queryForObject("SELECT title FROM portfolio_credits WHERE id=?", String.class, id(2))).isEqualTo("작품2");
        assertThat(jdbc.queryForObject("SELECT created_at FROM portfolio_credits WHERE id=?", OffsetDateTime.class, id(1))
                .toInstant()).isEqualTo(now);
    }

    @Test
    @DisplayName("deleteCredit: 그 회원의 행만 지우고 true 다. 다시 지우거나 남의 것이면 false 다")
    void deleteCreditRemovesOnlyTheOwnersRow() {
        UUID owner = member();
        UUID other = member();
        row(owner);
        row(other);
        credit(owner, id(1), 0, now);
        credit(other, id(2), 0, now);

        assertThat(portfolios.deleteCredit(owner, id(1))).isTrue();
        assertThat(portfolios.deleteCredit(owner, id(1))).isFalse();
        assertThat(portfolios.deleteCredit(owner, id(2))).isFalse();
        assertThat(jdbc.queryForList("SELECT id FROM portfolio_credits", UUID.class)).containsExactly(id(2));
    }

    @Test
    @DisplayName("orderCredits·orderPhotos: 지금 있는 것과 같은 집합이면 보낸 순서대로 0부터 적는다. 빠짐·중복·모르는 id 는 false 이고 바꾸지 않는다. 사진은 올리기가 끝난 것만 센다")
    void reorderRewritesTheOrderOnlyForTheExactSet() {
        UUID owner = member();
        row(owner);
        credit(owner, id(1), 0, now);
        credit(owner, id(2), 1, now);
        credit(owner, id(3), 2, now);
        photo(owner, id(11), 0, now, now);
        photo(owner, id(12), 1, now, now);
        photo(owner, id(13), null, now.plusSeconds(600), null);

        assertThat(portfolios.orderCredits(owner, List.of(id(3), id(1), id(2)))).isTrue();
        assertThat(sortOrders("portfolio_credits", owner)).containsExactly("1=1", "2=2", "3=0");
        assertThat(portfolios.orderCredits(owner, List.of(id(3), id(1)))).isFalse();
        assertThat(portfolios.orderCredits(owner, List.of(id(3), id(1), id(1)))).isFalse();
        assertThat(portfolios.orderCredits(owner, List.of(id(3), id(1), id(2), id(4)))).isFalse();
        assertThat(portfolios.orderCredits(owner, List.of(id(3), id(1), id(4)))).isFalse();
        assertThat(sortOrders("portfolio_credits", owner)).containsExactly("1=1", "2=2", "3=0");

        assertThat(portfolios.orderPhotos(owner, List.of(id(12), id(11), id(13)))).as("올리는 중인 사진은 목록에 없다").isFalse();
        assertThat(portfolios.orderPhotos(owner, List.of(id(12), id(11)))).isTrue();
        assertThat(sortOrders("portfolio_photos", owner)).containsExactly("11=1", "12=0", "13=null");

        UUID empty = member();
        assertThat(portfolios.orderCredits(empty, List.of())).as("빈 목록에 빈 목록").isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM portfolios WHERE user_id=?", Integer.class, empty))
                .as("행을 잡는 쓰기라 행이 생긴다").isEqualTo(1);
    }

    @Test
    @DisplayName("beginPhoto: 그 회원의 시한이 지난(시한과 같은 시각 포함) 올리기만 지우고 그 키를 바로 지우도록 장부에 올린다. 올리는 중인 것도 장수에 센다. 상한이면 적지 않지만 치운 것은 남는다")
    void beginPhotoClearsExpiredUploadsAndCountsPendingOnes() throws Exception {
        UUID owner = member();
        UUID other = member();
        row(owner);
        row(other);
        photo(owner, id(1), 0, now.minus(Duration.ofDays(1)), now.minus(Duration.ofDays(1)));
        photo(owner, id(2), null, now, null);
        photo(owner, id(3), null, now.minus(Duration.ofHours(1)), null);
        photo(owner, id(4), null, now.plus(1, ChronoUnit.MICROS), null);
        photo(other, id(5), null, now.minus(Duration.ofHours(1)), null);

        PhotoSlot slot = portfolios.beginPhoto(owner, pending(id(6), now.plusSeconds(1800).plusNanos(123_456_789)), 10, now);

        assertThat(slot.accepted()).isTrue();
        assertThat(slot.cleanupOperationIds()).singleElement().satisfies(operation -> {
            assertThat(scheduledKeys(operation)).containsExactlyInAnyOrder(key(id(2)), key(id(3)));
            assertThat(nextAttempt(operation)).isEqualTo(now);
        });
        assertThat(jdbc.queryForList("SELECT id FROM portfolio_photos ORDER BY id", UUID.class))
                .containsExactly(id(1), id(4), id(5), id(6));
        assertThat(jdbc.queryForMap("""
                SELECT user_id,object_key,mime_type,size_bytes,sort_order,uploaded_at FROM portfolio_photos WHERE id=?
                """, id(6)))
                .containsEntry("user_id", owner).containsEntry("object_key", key(id(6))).containsEntry("mime_type", "image/jpeg")
                .containsEntry("size_bytes", 1_000L).containsEntry("sort_order", null).containsEntry("uploaded_at", null);
        assertThat(instant("SELECT expires_at FROM portfolio_photos WHERE id=?", id(6)))
                .isEqualTo(now.plusSeconds(1800).plus(123_457, ChronoUnit.MICROS));

        assertThat(portfolios.beginPhoto(owner, pending(id(7), now.plusSeconds(1800)), 10, now).cleanupOperationIds())
                .as("치울 것이 없으면 장부에 올리지 않는다").isEmpty();
        photo(owner, id(8), null, now.minusSeconds(1), null);
        PhotoSlot full = portfolios.beginPhoto(owner, pending(id(9), now.plusSeconds(1800)), 4, now);
        assertThat(full.accepted()).as("끝난 1 + 올리는 중 3 = 4").isFalse();
        assertThat(full.cleanupOperationIds()).singleElement()
                .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactly(key(id(8))));
        assertThat(jdbc.queryForList("SELECT id FROM portfolio_photos WHERE user_id=? ORDER BY id", UUID.class, owner))
                .containsExactly(id(1), id(4), id(6), id(7));
        assertThat(count("account_cleanup_operations")).isEqualTo(2);
    }

    @Test
    @DisplayName("photo: 그 회원의 사진을 올리기 상태와 함께 낸다. 남의 것·없는 것은 null 이다")
    void photoReadsTheOwnersRowWithItsUploadState() {
        UUID owner = member();
        UUID other = member();
        row(owner);
        row(other);
        photo(owner, id(1), null, now.plusSeconds(600), null);
        photo(owner, id(2), 0, now, now);
        photo(other, id(3), 0, now, now);

        assertThat(portfolios.photo(owner, id(1)))
                .isEqualTo(new PendingPhoto(id(1), key(id(1)), "image/jpeg", 1_000L, now.plusSeconds(600), false));
        assertThat(portfolios.photo(owner, id(2)).uploaded()).isTrue();
        assertThat(portfolios.photo(owner, id(3))).isNull();
        assertThat(portfolios.photo(owner, UUID.randomUUID())).isNull();
    }

    @Test
    @DisplayName("completePhoto: 올리기가 끝난 사진의 가장 큰 sort_order 다음에 붙이고 시각을 마이크로초로 반올림해 적는다. 이미 끝난 것·남의 것은 그대로다")
    void completePhotoAppendsAfterTheLastUploadedPhoto() {
        UUID owner = member();
        UUID other = member();
        row(owner);
        row(other);
        photo(owner, id(1), 0, now, now);
        photo(owner, id(2), 3, now, now);
        photo(owner, id(3), null, now.plusSeconds(600), null);
        photo(owner, id(4), null, now.plusSeconds(600), null);
        photo(other, id(5), null, now.plusSeconds(600), null);

        portfolios.completePhoto(owner, id(3), now.plusNanos(123_456_789));
        portfolios.completePhoto(owner, id(3), now.plusSeconds(60));
        portfolios.completePhoto(owner, id(5), now);

        assertThat(sortOrders("portfolio_photos", owner)).containsExactly("1=0", "2=3", "3=4", "4=null");
        assertThat(instant("SELECT uploaded_at FROM portfolio_photos WHERE id=?", id(3)))
                .isEqualTo(now.plus(123_457, ChronoUnit.MICROS));
        assertThat(jdbc.queryForObject("SELECT uploaded_at FROM portfolio_photos WHERE id=?", OffsetDateTime.class, id(5)))
                .isNull();
    }

    @Test
    @DisplayName("deletePhoto: 행을 지우고 객체 삭제를 장부에 올린다 — 끝난 사진은 바로, 올리는 중이던 사진은 주소의 시한 뒤에. 없거나 남의 것이면 null 이고 그대로다")
    void deletePhotoSchedulesTheObjectAfterItsAddressDies() throws Exception {
        UUID owner = member();
        UUID other = member();
        row(owner);
        row(other);
        photo(owner, id(1), 0, now.minusSeconds(60), now.minusSeconds(60));
        photo(owner, id(2), null, now.plusSeconds(600), null);
        photo(other, id(3), 0, now, now);

        List<UUID> uploaded = portfolios.deletePhoto(owner, id(1), now);
        List<UUID> pending = portfolios.deletePhoto(owner, id(2), now);

        assertThat(uploaded).singleElement().satisfies(operation -> {
            assertThat(scheduledKeys(operation)).containsExactly(key(id(1)));
            assertThat(nextAttempt(operation)).isEqualTo(now);
        });
        assertThat(pending).singleElement().satisfies(operation -> {
            assertThat(scheduledKeys(operation)).containsExactly(key(id(2)));
            assertThat(nextAttempt(operation)).isEqualTo(now.plusSeconds(600));
        });
        assertThat(portfolios.deletePhoto(owner, id(1), now)).isNull();
        assertThat(portfolios.deletePhoto(owner, id(3), now)).isNull();
        assertThat(jdbc.queryForList("SELECT id FROM portfolio_photos", UUID.class)).containsExactly(id(3));
        assertThat(count("account_cleanup_operations")).isEqualTo(2);
    }

    @Test
    @DisplayName("share: 처음 켤 때만 새 slug 를 쓰고 꺼도 남는다. 한 번도 켜지 않고 끄면 slug 가 없다. updated_at 은 트랜잭션 시작 시각이다")
    void shareKeepsTheFirstSlug() {
        UUID owner = member();
        UUID quiet = member();

        assertThat(portfolios.share(owner, true, "slug-a")).isEqualTo(new Portfolio.Share(true, "slug-a"));
        assertThat(portfolios.share(owner, false, "slug-b")).isEqualTo(new Portfolio.Share(false, "slug-a"));
        Portfolio.Share again = inTransaction(() -> {
            Portfolio.Share share = portfolios.share(owner, true, "slug-c");
            assertThat(jdbc.queryForObject("SELECT updated_at=now() FROM portfolios WHERE user_id=?", Boolean.class, owner))
                    .isTrue();
            return share;
        });
        assertThat(again).isEqualTo(new Portfolio.Share(true, "slug-a"));

        assertThat(portfolios.share(quiet, false, "slug-d")).isEqualTo(new Portfolio.Share(false, null));
        assertThat(portfolios.share(quiet, true, "slug-e")).isEqualTo(new Portfolio.Share(true, "slug-e"));
    }

    @Test
    @DisplayName("share: 새 slug 가 남의 것과 겹치면 DataIntegrityViolationException 이고 그 트랜잭션은 아무것도 남기지 않는다(행도 만들지 않는다)")
    void aSlugCollisionWritesNothing() {
        UUID owner = member();
        UUID late = member();
        portfolios.share(owner, true, "slug-taken");

        assertThatThrownBy(() -> portfolios.share(late, true, "slug-taken"))
                .isInstanceOf(DataIntegrityViolationException.class);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM portfolios WHERE user_id=?", Integer.class, late)).isZero();
        assertThat(portfolios.share(late, true, "slug-free")).isEqualTo(new Portfolio.Share(true, "slug-free"));
    }

    @Test
    @DisplayName("sharedOwner: 그 slug 의 공유가 켜져 있을 때만 주인을 낸다. 꺼졌거나 없는 slug 는 null 이다")
    void sharedOwnerFindsOnlyEnabledLinks() {
        UUID owner = member();
        portfolios.share(owner, true, "slug-on");

        assertThat(portfolios.sharedOwner("slug-on")).isEqualTo(owner);
        assertThat(portfolios.sharedOwner("slug-none")).isNull();
        portfolios.share(owner, false, "slug-other");
        assertThat(portfolios.sharedOwner("slug-on")).isNull();
    }

    // ---- 잠금 세기 ----

    @Test
    @DisplayName("행을 잡는 쓰기는 users 행을, 이어서 포트폴리오 행을 FOR UPDATE 로 잡는다 — 바깥 연결의 FOR KEY SHARE 뒤에서 차례로 기다린다")
    void lockingWritesTakeForUpdateOnTheUserThenThePortfolio() throws Exception {
        UUID owner = member();
        row(owner);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lock(probe, "SELECT 1 FROM users WHERE id=? FOR KEY SHARE", owner);
            Future<?> first = pool.submit(() -> portfolios.saveIntro(owner, "users 뒤"));
            String waitingOnUser = awaitWaiting("from users");
            probe.rollback();
            first.get(20, TimeUnit.SECONDS);

            lock(probe, "SELECT 1 FROM portfolios WHERE user_id=? FOR KEY SHARE", owner);
            Future<?> second = pool.submit(() -> portfolios.saveIntro(owner, "포트폴리오 뒤"));
            String waitingOnPortfolio = awaitWaiting("from portfolios");
            probe.rollback();
            second.get(20, TimeUnit.SECONDS);

            assertThat(waitingOnUser.toLowerCase(Locale.ROOT)).contains("for update").doesNotContain("no key");
            assertThat(waitingOnPortfolio.toLowerCase(Locale.ROOT)).contains("for update").doesNotContain("no key");
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT intro FROM portfolios WHERE user_id=?", String.class, owner))
                .isEqualTo("포트폴리오 뒤");
    }

    @Test
    @DisplayName("포트폴리오 행을 잡은 동안 그 회원의 사진 행은 새로 들어오지 못한다 — 자식 INSERT 가 FK 로 거는 FOR KEY SHARE 가 FOR UPDATE 뒤에서 기다린다")
    void aHeldPortfolioLockKeepsNewPhotoRowsOut() throws Exception {
        UUID owner = member();
        row(owner);
        photo(owner, id(1), null, now.minusSeconds(60), null);
        CountDownLatch cleared = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<PhotoSlot> holder = pool.submit(() -> inTransaction(() -> {
                PhotoSlot slot = portfolios.beginPhoto(owner, pending(id(2), now.plusSeconds(600)), 10, now);
                cleared.countDown();
                await(release);
                return slot;
            }));
            await(cleared);
            Future<Integer> intruder = pool.submit(() -> {
                try (Connection probe = probe()) {
                    probe.setAutoCommit(true);
                    try (PreparedStatement insert = probe.prepareStatement("""
                            INSERT INTO portfolio_photos(id,user_id,object_key,mime_type,size_bytes,expires_at)
                            VALUES (?,?,?,'image/jpeg',1,?)
                            """)) {
                        insert.setObject(1, id(3));
                        insert.setObject(2, owner);
                        insert.setString(3, key(id(3)));
                        insert.setObject(4, now.minusSeconds(60).atOffset(ZoneOffset.UTC));
                        return insert.executeUpdate();
                    }
                }
            });
            assertThat(awaitWaiting("insert into portfolio_photos").toLowerCase(Locale.ROOT))
                    .startsWith("insert into portfolio_photos");
            release.countDown();

            assertThat(holder.get(20, TimeUnit.SECONDS).cleanupOperationIds()).hasSize(1);
            assertThat(intruder.get(20, TimeUnit.SECONDS)).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT id FROM portfolio_photos ORDER BY id", UUID.class)).containsExactly(id(2), id(3));
    }

    @Test
    @DisplayName("행 하나를 고치는 쓰기(경력 고치기·사진 끝내기)는 FOR NO KEY UPDATE 세기다 — FOR KEY SHARE 는 막지 않고 FOR SHARE 뒤에서는 기다린다")
    void rowUpdatesLockLikeAnUpdateOfNonKeyColumns() throws Exception {
        UUID owner = member();
        row(owner);
        credit(owner, id(1), 0, now);
        photo(owner, id(2), null, now.plusSeconds(600), null);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lock(probe, "SELECT 1 FROM portfolio_credits WHERE id=? FOR KEY SHARE", id(1));
            assertThat(pool.submit(() -> portfolios.updateCredit(owner, id(1), "막히지 않음", null, null, null))
                    .get(20, TimeUnit.SECONDS)).extracting(Portfolio.Credit::title).isEqualTo("막히지 않음");
            probe.rollback();
            lock(probe, "SELECT 1 FROM portfolio_photos WHERE id=? FOR KEY SHARE", id(2));
            pool.submit(() -> portfolios.completePhoto(owner, id(2), now)).get(20, TimeUnit.SECONDS);
            probe.rollback();

            lock(probe, "SELECT 1 FROM portfolio_credits WHERE id=? FOR SHARE", id(1));
            Future<Portfolio.Credit> blocked = pool.submit(() -> portfolios.updateCredit(owner, id(1), "기다림", null, null, null));
            String waiting = awaitWaiting("update portfolio_credits");
            probe.rollback();

            assertThat(waiting.toLowerCase(Locale.ROOT)).contains("update portfolio_credits");
            assertThat(blocked.get(20, TimeUnit.SECONDS).title()).isEqualTo("기다림");
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT uploaded_at IS NOT NULL FROM portfolio_photos WHERE id=?", Boolean.class, id(2)))
                .isTrue();
    }

    @Test
    @DisplayName("지우는 쓰기(경력 지우기·사진 지우기·시한 지난 올리기 치우기)는 지울 행을 FOR UPDATE 세기로 잡는다 — 바깥 연결의 FOR KEY SHARE 뒤에서 기다린다")
    void deletesWaitBehindAKeyShareOnTheRow() throws Exception {
        UUID owner = member();
        row(owner);
        credit(owner, id(1), 0, now);
        photo(owner, id(2), 0, now, now);
        photo(owner, id(3), null, now.minusSeconds(60), null);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lock(probe, "SELECT 1 FROM portfolio_credits WHERE id=? FOR KEY SHARE", id(1));
            Future<Boolean> credit = pool.submit(() -> portfolios.deleteCredit(owner, id(1)));
            awaitWaiting("portfolio_credits");
            probe.rollback();
            assertThat(credit.get(20, TimeUnit.SECONDS)).isTrue();

            lock(probe, "SELECT 1 FROM portfolio_photos WHERE id=? FOR KEY SHARE", id(2));
            Future<List<UUID>> photo = pool.submit(() -> portfolios.deletePhoto(owner, id(2), now));
            awaitWaiting("portfolio_photos");
            probe.rollback();
            assertThat(photo.get(20, TimeUnit.SECONDS)).hasSize(1);

            lock(probe, "SELECT 1 FROM portfolio_photos WHERE id=? FOR KEY SHARE", id(3));
            Future<PhotoSlot> sweep = pool.submit(() -> portfolios.beginPhoto(owner, pending(id(4), now.plusSeconds(600)), 10, now));
            awaitWaiting("portfolio_photos");
            probe.rollback();
            assertThat(sweep.get(20, TimeUnit.SECONDS).cleanupOperationIds()).hasSize(1);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT id FROM portfolio_photos", UUID.class)).containsExactly(id(4));
    }

    // ---- 경합 ----

    @Test
    @DisplayName("경력 상한: 마지막 한 자리를 두 요청이 노리면 뒤의 것이 앞의 커밋을 기다렸다가 null 을 받는다. 하나만 들어간다")
    void twoAddsRacingForTheLastCreditSlot() throws Exception {
        UUID owner = member();
        CountDownLatch firstAdded = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Portfolio.Credit> first = pool.submit(() -> inTransaction(() -> {
                Portfolio.Credit added = portfolios.addCredit(owner, "먼저", "역할", 2024, "play", 1);
                firstAdded.countDown();
                await(release);
                return added;
            }));
            await(firstAdded);
            Future<Portfolio.Credit> second = pool.submit(() -> portfolios.addCredit(owner, "나중", "역할", 2024, "play", 1));
            awaitWaiting("from users");
            release.countDown();

            assertThat(first.get(20, TimeUnit.SECONDS)).extracting(Portfolio.Credit::title).isEqualTo("먼저");
            assertThat(second.get(20, TimeUnit.SECONDS)).isNull();
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT title FROM portfolio_credits", String.class)).containsExactly("먼저");
    }

    @Test
    @DisplayName("경력 상한: 두 스레드가 같은 순간에 마지막 한 자리를 노려도 스무 번 모두 하나만 들어간다")
    void concurrentAddsRespectTheLimit() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 20; round++) {
                UUID owner = member();
                CountDownLatch start = new CountDownLatch(1);
                Callable<Portfolio.Credit> add = () -> {
                    start.await();
                    return portfolios.addCredit(owner, "작품", "배역", 2024, "play", 1);
                };
                Future<Portfolio.Credit> first = pool.submit(add);
                Future<Portfolio.Credit> second = pool.submit(add);
                start.countDown();
                long added = Stream.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS))
                        .filter(Objects::nonNull).count();
                assertThat(added).as("round %d", round).isEqualTo(1);
                assertThat(jdbc.queryForObject("SELECT count(*) FROM portfolio_credits WHERE user_id=?", Integer.class, owner))
                        .as("round %d", round).isEqualTo(1);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("사진 올리기와 지우기가 같은 시한 지난 올리기를 노리면: 먼저 잡은 쪽만 그 키를 장부에 올리고 뒤의 쪽은 기다렸다가 없는 것으로 본다. 올리기가 먼저면 지우기가 그 행에서, 지우기가 먼저면 올리기가 users 행에서 기다린다")
    void aReservationAndADeletionOverlapOnAnExpiredUpload() throws Exception {
        UUID owner = member();
        row(owner);
        photo(owner, id(1), null, now.minusSeconds(60), null);
        photo(owner, id(2), null, now.minusSeconds(60), null);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch reserved = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);
            Future<PhotoSlot> reservation = pool.submit(() -> inTransaction(() -> {
                PhotoSlot slot = portfolios.beginPhoto(owner, pending(id(3), now.plusSeconds(600)), 10, now);
                reserved.countDown();
                await(release);
                return slot;
            }));
            await(reserved);
            Future<List<UUID>> deletion = pool.submit(() -> portfolios.deletePhoto(owner, id(1), now));
            awaitWaiting("portfolio_photos");
            release.countDown();

            assertThat(reservation.get(20, TimeUnit.SECONDS).cleanupOperationIds()).singleElement()
                    .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactlyInAnyOrder(key(id(1)), key(id(2))));
            assertThat(deletion.get(20, TimeUnit.SECONDS)).as("앞의 올리기가 이미 치웠다").isNull();
            assertThat(count("account_cleanup_operations")).isEqualTo(1);

            photo(owner, id(4), null, now.minusSeconds(60), null);
            CountDownLatch deleted = new CountDownLatch(1);
            CountDownLatch release2 = new CountDownLatch(1);
            Future<List<UUID>> deletionFirst = pool.submit(() -> inTransaction(() -> {
                List<UUID> scheduled = portfolios.deletePhoto(owner, id(4), now);
                deleted.countDown();
                await(release2);
                return scheduled;
            }));
            await(deleted);
            Future<PhotoSlot> reservationLater = pool.submit(() ->
                    portfolios.beginPhoto(owner, pending(id(5), now.plusSeconds(600)), 10, now));
            assertThat(awaitWaiting("from users")).as("지우기가 장부에 넣은 행이 FK 로 users 행을 잡고 있다")
                    .containsIgnoringCase("for update");
            release2.countDown();

            assertThat(deletionFirst.get(20, TimeUnit.SECONDS)).singleElement()
                    .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactly(key(id(4))));
            PhotoSlot later = reservationLater.get(20, TimeUnit.SECONDS);
            assertThat(later.accepted()).isTrue();
            assertThat(later.cleanupOperationIds()).as("앞의 지우기가 이미 장부에 올렸다").isEmpty();
            assertThat(count("account_cleanup_operations")).isEqualTo(2);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT id FROM portfolio_photos ORDER BY id", UUID.class)).containsExactly(id(3), id(5));
    }

    @Test
    @DisplayName("시한 지난 올리기를 치우는 사이 다른 연결이 같은 행을 지우고 있으면 그 커밋을 기다렸다가 건너뛴다 — 지워진 행의 키를 장부에 올리지 않는다. 되돌리면 치운다")
    void theSweepSkipsARowDeletedUnderneathIt() throws Exception {
        UUID owner = member();
        row(owner);
        photo(owner, id(1), null, now.minusSeconds(60), null);
        photo(owner, id(2), null, now.minusSeconds(60), null);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lock(probe, "DELETE FROM portfolio_photos WHERE id=?", id(1));
            Future<PhotoSlot> committed = pool.submit(() ->
                    portfolios.beginPhoto(owner, pending(id(3), now.plusSeconds(600)), 10, now));
            awaitWaiting("portfolio_photos");
            probe.commit();
            assertThat(committed.get(20, TimeUnit.SECONDS).cleanupOperationIds()).singleElement()
                    .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactly(key(id(2))));

            photo(owner, id(4), null, now.minusSeconds(60), null);
            lock(probe, "DELETE FROM portfolio_photos WHERE id=?", id(4));
            Future<PhotoSlot> rolledBack = pool.submit(() ->
                    portfolios.beginPhoto(owner, pending(id(5), now.plusSeconds(600)), 10, now));
            awaitWaiting("portfolio_photos");
            probe.rollback();
            assertThat(rolledBack.get(20, TimeUnit.SECONDS).cleanupOperationIds()).singleElement()
                    .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactly(key(id(4))));
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT id FROM portfolio_photos ORDER BY id", UUID.class)).containsExactly(id(3), id(5));
    }

    @Test
    @DisplayName("공유를 두 요청이 함께 켜면 뒤의 것이 앞의 커밋을 기다렸다가 앞의 slug 를 낸다. 앞의 트랜잭션 안에서 다시 읽어도 방금 쓴 값이다")
    void twoShareChangesAtOnce() throws Exception {
        UUID owner = member();
        CountDownLatch shared = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Portfolio.Share> first = pool.submit(() -> inTransaction(() -> {
                Portfolio.Share share = portfolios.share(owner, true, "slug-first");
                shared.countDown();
                await(release);
                assertThat(portfolios.find(owner).share()).as("같은 트랜잭션에서 다시 읽어도 방금 쓴 값이다")
                        .isEqualTo(new Portfolio.Share(true, "slug-first"));
                return share;
            }));
            await(shared);
            Future<Portfolio.Share> second = pool.submit(() -> portfolios.share(owner, true, "slug-second"));
            awaitWaiting("from users");
            release.countDown();

            assertThat(first.get(20, TimeUnit.SECONDS)).isEqualTo(new Portfolio.Share(true, "slug-first"));
            assertThat(second.get(20, TimeUnit.SECONDS)).isEqualTo(new Portfolio.Share(true, "slug-first"));
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT share_slug FROM portfolios WHERE user_id=?", String.class, owner))
                .isEqualTo("slug-first");
    }

    @Test
    @DisplayName("같은 경력을 두 요청이 함께 고치면 뒤의 것이 앞의 커밋을 기다렸다가 두 쪽의 값이 합쳐진 행을 낸다. 앞의 트랜잭션 안에서 다시 읽어도 방금 쓴 값이다")
    void twoCreditEditsAtOnce() throws Exception {
        UUID owner = member();
        row(owner);
        credit(owner, id(1), 0, now);
        CountDownLatch edited = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Portfolio.Credit> first = pool.submit(() -> inTransaction(() -> {
                Portfolio.Credit changed = portfolios.updateCredit(owner, id(1), null, "먼저 고친 역할", null, null);
                edited.countDown();
                await(release);
                assertThat(portfolios.find(owner).credits()).singleElement().extracting(Portfolio.Credit::role)
                        .as("같은 트랜잭션에서 다시 읽어도 방금 쓴 값이다").isEqualTo("먼저 고친 역할");
                return changed;
            }));
            await(edited);
            Future<Portfolio.Credit> second = pool.submit(() ->
                    portfolios.updateCredit(owner, id(1), "나중 고친 작품", null, null, null));
            awaitWaiting("update portfolio_credits");
            release.countDown();

            assertThat(first.get(20, TimeUnit.SECONDS))
                    .isEqualTo(new Portfolio.Credit(id(1), "작품1", "먼저 고친 역할", 2024, "musical"));
            assertThat(second.get(20, TimeUnit.SECONDS))
                    .isEqualTo(new Portfolio.Credit(id(1), "나중 고친 작품", "먼저 고친 역할", 2024, "musical"));
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류. RETURNING 을 나눈 경력 고치기·공유는 다시 읽기가, 사진 지우기·시한 지난 올리기 치우기는 잠가 읽기 뒤 id 로 지우기가 된다")
    void eachPortMethodSendsTheseStatements() {
        UUID owner = member();
        String usersLock = "select users for update";
        String create = "insert portfolios on conflict";
        String portfolioLock = "select portfolios for update";

        assertThat(statementsOf(() -> portfolios.find(owner))).containsExactly("select portfolios");
        assertThat(statementsOf(() -> {
            portfolios.saveIntro(owner, "소개");
            return null;
        })).containsExactly(usersLock, create, portfolioLock, "update portfolios");
        assertThat(statementsOf(() -> portfolios.addCredit(owner, "작품", "역할", 2024, "play", 50)))
                .containsExactly(usersLock, create, portfolioLock, "count portfolio_credits", "insert portfolio_credits");
        UUID credit = jdbc.queryForObject("SELECT id FROM portfolio_credits", UUID.class);
        assertThat(statementsOf(() -> portfolios.addCredit(owner, "넘침", "역할", 2024, "play", 1)))
                .containsExactly(usersLock, create, portfolioLock, "count portfolio_credits");
        assertThat(statementsOf(() -> portfolios.updateCredit(owner, credit, "고침", null, null, null)))
                .as("RETURNING 대신 같은 트랜잭션에서 다시 읽는다")
                .containsExactly("update portfolio_credits", "select portfolio_credits");
        assertThat(statementsOf(() -> portfolios.updateCredit(owner, UUID.randomUUID(), "없음", null, null, null)))
                .as("고친 행이 없으면 다시 읽지 않는다")
                .containsExactly("update portfolio_credits");
        assertThat(statementsOf(() -> portfolios.orderCredits(owner, List.of(credit))))
                .containsExactly(usersLock, create, portfolioLock, "select portfolio_credits", "update portfolio_credits");
        assertThat(statementsOf(() -> portfolios.find(owner)))
                .containsExactly("select portfolios", "select portfolio_credits", "select portfolio_photos");

        photo(owner, id(1), null, now.minusSeconds(60), null);
        assertThat(statementsOf(() -> portfolios.beginPhoto(owner, pending(id(2), now.plusSeconds(600)), 10, now)))
                .as("시한 지난 올리기를 치울 때")
                .containsExactly(usersLock, create, portfolioLock, "select portfolio_photos for update",
                        "delete portfolio_photos", "insert account_cleanup_operations", "count portfolio_photos",
                        "insert portfolio_photos");
        assertThat(statementsOf(() -> portfolios.beginPhoto(owner, pending(id(3), now.plusSeconds(600)), 10, now)))
                .as("치울 것이 없을 때")
                .containsExactly(usersLock, create, portfolioLock, "select portfolio_photos for update",
                        "count portfolio_photos", "insert portfolio_photos");
        assertThat(statementsOf(() -> portfolios.beginPhoto(owner, pending(id(4), now.plusSeconds(600)), 2, now)))
                .as("상한일 때")
                .containsExactly(usersLock, create, portfolioLock, "select portfolio_photos for update", "count portfolio_photos");
        assertThat(statementsOf(() -> portfolios.photo(owner, id(2)))).containsExactly("select portfolio_photos");
        assertThat(statementsOf(() -> {
            portfolios.completePhoto(owner, id(2), now);
            return null;
        })).containsExactly(usersLock, create, portfolioLock, "update portfolio_photos");
        assertThat(statementsOf(() -> portfolios.orderPhotos(owner, List.of(id(2)))))
                .containsExactly(usersLock, create, portfolioLock, "select portfolio_photos", "update portfolio_photos");
        assertThat(statementsOf(() -> portfolios.deletePhoto(owner, id(3), now)))
                .containsExactly("select portfolio_photos for update", "delete portfolio_photos",
                        "insert account_cleanup_operations");
        assertThat(statementsOf(() -> portfolios.deletePhoto(owner, id(3), now)))
                .containsExactly("select portfolio_photos for update");
        assertThat(statementsOf(() -> portfolios.deleteCredit(owner, credit))).containsExactly("delete portfolio_credits");
        assertThat(statementsOf(() -> portfolios.share(owner, true, "slug-trace")))
                .containsExactly(usersLock, create, portfolioLock, "update portfolios", "select portfolios");
        assertThat(statementsOf(() -> portfolios.sharedOwner("slug-trace"))).containsExactly("select portfolios");
    }

    // ---- 도움 ----

    private static final Pattern CTE = Pattern.compile("^with \\w+ as \\( ?(update|delete from) (\\w+)\\b.*");
    private static final Pattern COUNT = Pattern.compile("^select count\\(.*?\\) from (\\w+)\\b.*");
    private static final Pattern SELECT = Pattern.compile("^select .*? from (\\w+)\\b.*");
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
        if ((matcher = SELECT.matcher(text)).matches()) {
            return "select " + matcher.group(1) + (text.contains(" for update") ? " for update" : "");
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

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(PortfolioRepositoryIT::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    private <T> T inTransaction(Supplier<T> body) {
        return new TransactionTemplate(transactionManager).execute(status -> body.get());
    }

    private UUID member() {
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", userId);
        return userId;
    }

    private void row(UUID owner) {
        jdbc.update("INSERT INTO portfolios(user_id) VALUES (?)", owner);
    }

    /** 제목 "작품<n>", 배역 "역할<n>", 2024, musical. n 은 id 의 끝 자리다. */
    private void credit(UUID owner, UUID creditId, int sortOrder, Instant createdAt) {
        int n = number(creditId);
        jdbc.update("""
                INSERT INTO portfolio_credits(id,user_id,title,role,year,kind,sort_order,created_at,updated_at)
                VALUES (?,?,?,?,2024,'musical',?,?,?)
                """, creditId, owner, "작품" + n, "역할" + n, sortOrder, utc(createdAt), utc(createdAt));
    }

    private void photo(UUID owner, UUID photoId, Integer sortOrder, Instant expiresAt, Instant uploadedAt) {
        jdbc.update("""
                INSERT INTO portfolio_photos(id,user_id,object_key,mime_type,size_bytes,sort_order,expires_at,uploaded_at)
                VALUES (?,?,?,'image/jpeg',1000,?,?,?)
                """, photoId, owner, key(photoId), sortOrder, utc(expiresAt), uploadedAt == null ? null : utc(uploadedAt));
    }

    private PendingPhoto pending(UUID photoId, Instant expiresAt) {
        return new PendingPhoto(photoId, key(photoId), "image/jpeg", 1_000L, expiresAt, false);
    }

    private static String key(UUID photoId) {
        return "users/test/portfolio/" + photoId;
    }

    private static UUID id(int n) {
        return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(n));
    }

    /** {@link #id} 의 n. */
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

    /** "<id 끝 자리>=<sort_order>", id 순. */
    private List<String> sortOrders(String table, UUID owner) {
        return jdbc.queryForList("SELECT id, sort_order FROM " + table + " WHERE user_id=? ORDER BY id", owner).stream()
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
