package com.acttub.actingapi.feature.portfolio;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.portfolio.app.PortfolioRepository;
import com.acttub.actingapi.feature.portfolio.app.PortfolioRepository.PendingPhoto;
import com.acttub.actingapi.feature.portfolio.domain.Portfolio;
import com.acttub.actingapi.support.AccountFixtures;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * SOMA-1112 표본: 포트폴리오 저장소의 포트 메서드를 정해진 순서로 한 번씩 부르고, 단계마다 Hibernate 가 보낸 SQL 과
 * 돌려받은 값을 {@code build/jpql-probe/portfolio-sql.md} 에 적는다. 네이티브 SQL 로 짠 저장소와 JPA 로 옮긴
 * 저장소에서 같은 테스트를 돌려 나가는 SQL 과 결과를 견준다. 결과 값은 두 구현이 같아야 한다(아래 단언).
 *
 * <p>조사용 테스트다. 브랜치에만 둔다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.portfolio.PortfolioSqlTraceIT$Recorder"
})
class PortfolioSqlTraceIT {

    /** 실행한 SQL 을 모은다. */
    public static class Recorder implements StatementInspector {
        static final List<String> STATEMENTS = Collections.synchronizedList(new ArrayList<>());

        @Override
        public String inspect(String sql) {
            STATEMENTS.add(sql);
            return sql;
        }
    }

    @Autowired
    PortfolioRepository portfolios;

    @Autowired
    JdbcTemplate jdbc;

    private final StringBuilder out = new StringBuilder();
    private final List<String> results = new ArrayList<>();
    private int total;

    @Test
    void traceEveryPortMethodOnce() throws Exception {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        UUID member = UUID.fromString("00000000-0000-0000-0000-00000000aa01");
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), member, "g-" + member);
        AccountFixtures.passGate(jdbc, member);
        Instant now = Instant.parse("2026-11-24T03:00:00Z");

        step("find(빈 포트폴리오)", () -> render(portfolios.find(member)));
        step("saveIntro", () -> {
            portfolios.saveIntro(member, "소개");
            return "ok";
        });
        Portfolio.Credit first = step("addCredit(첫째)", () -> portfolios.addCredit(member, "햄릿", "햄릿", 2024, "play", 50));
        Portfolio.Credit second = step("addCredit(둘째)", () -> portfolios.addCredit(member, "갈매기", "트레플료프", 2025, "film", 50));
        step("updateCredit(제목만)", () -> portfolios.updateCredit(member, first.id(), "햄릿(재공연)", null, null, null));
        step("updateCredit(없는 id)", () -> String.valueOf(portfolios.updateCredit(member, UUID.randomUUID(), "x", null, null, null)));
        step("orderCredits", () -> portfolios.orderCredits(member, List.of(second.id(), first.id())));
        step("orderCredits(목록이 다름)", () -> portfolios.orderCredits(member, List.of(first.id())));
        step("deleteCredit", () -> portfolios.deleteCredit(member, second.id()));
        step("deleteCredit(두 번째)", () -> portfolios.deleteCredit(member, second.id()));

        UUID expired = UUID.fromString("00000000-0000-0000-0000-00000000bb00");
        jdbc.update("""
                INSERT INTO portfolio_photos(id,user_id,object_key,mime_type,size_bytes,expires_at)
                VALUES (?,?,'portfolio/expired','image/jpeg',1,?)
                """, expired, member, OffsetDateTime.of(2026, 11, 1, 0, 0, 0, 0, ZoneOffset.UTC));
        UUID p1 = UUID.fromString("00000000-0000-0000-0000-00000000bb01");
        UUID p2 = UUID.fromString("00000000-0000-0000-0000-00000000bb02");
        step("beginPhoto(시한 지난 올리기를 치움)", () -> portfolios.beginPhoto(member,
                new PendingPhoto(p1, "portfolio/p1", "image/jpeg", 1000, now.plus(10, ChronoUnit.MINUTES), false), 10, now)
                .accepted());
        step("completePhoto", () -> {
            portfolios.completePhoto(member, p1, now);
            return "ok";
        });
        step("beginPhoto(상한)", () -> portfolios.beginPhoto(member,
                new PendingPhoto(p2, "portfolio/p2", "image/jpeg", 1000, now.plus(10, ChronoUnit.MINUTES), false), 1, now)
                .accepted());
        step("beginPhoto", () -> portfolios.beginPhoto(member,
                new PendingPhoto(p2, "portfolio/p2", "image/jpeg", 1000, now.plus(10, ChronoUnit.MINUTES), false), 10, now)
                .accepted());
        step("completePhoto(둘째)", () -> {
            portfolios.completePhoto(member, p2, now.plusSeconds(1));
            return "ok";
        });
        step("photo", () -> portfolios.photo(member, p1));
        step("orderPhotos", () -> portfolios.orderPhotos(member, List.of(p2, p1)));
        step("deletePhoto", () -> portfolios.deletePhoto(member, p2, now).size());
        step("deletePhoto(없음)", () -> String.valueOf(portfolios.deletePhoto(member, p2, now)));
        step("share(켬)", () -> portfolios.share(member, true, "slug-trace"));
        step("share(끔)", () -> portfolios.share(member, false, "slug-other"));
        step("sharedOwner(꺼짐)", () -> String.valueOf(portfolios.sharedOwner("slug-trace")));
        step("share(다시 켬)", () -> portfolios.share(member, true, "slug-other"));
        step("sharedOwner", () -> portfolios.sharedOwner("slug-trace"));
        step("find(채운 포트폴리오)", () -> render(portfolios.find(member)));

        String header = "# 포트폴리오 저장소가 보낸 SQL\n\n`PortfolioSqlTraceIT` 가 만든다. 단계마다 Hibernate 가 보낸 SQL 과 "
                + "돌려받은 값. 정리 장부(`PortfolioPhotoCleanup`)가 보낸 SQL 도 그 단계에 함께 잡힌다.\n\n총 SQL " + total + "개\n\n"
                + "## 돌려받은 값\n\n```\n" + String.join("\n", results) + "\n```\n";
        Path path = Path.of("build/jpql-probe/portfolio-sql.md");
        Files.createDirectories(path.getParent());
        Files.writeString(path, header + out);
        // 두 구현이 같은 결과를 내야 한다(네이티브 구현에서 관찰한 값).
        assertThat(String.join("\n", results)).isEqualTo(Files.readString(
                Path.of("src/test/resources/portfolio-sql-trace-results.txt")).strip());
    }

    private <T> T step(String label, Supplier<T> body) {
        Recorder.STATEMENTS.clear();
        T value = body.get();
        List<String> sql = List.copyOf(Recorder.STATEMENTS);
        total += sql.size();
        out.append("\n## ").append(label).append(" — SQL ").append(sql.size()).append("개\n\n```sql\n");
        sql.forEach(text -> out.append(text.strip().replaceAll("\\s+", " ")).append(";\n"));
        out.append("```\n");
        // 저장소가 만든 무작위 id 는 실행마다 달라 지운다(고정 id 는 00000000-… 로 시작한다).
        results.add((label + " → " + (value instanceof Portfolio portfolio ? render(portfolio) : String.valueOf(value)))
                .replaceAll("\\b(?!00000000-0000-0000-0000-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b", "<생성 id>"));
        return value;
    }

    private static String render(Portfolio portfolio) {
        return "intro=" + portfolio.intro() + " credits=" + portfolio.credits().stream()
                .map(credit -> credit.title() + "/" + credit.role() + "/" + credit.year() + "/" + credit.kind()).toList()
                + " photos=" + portfolio.photos().stream().map(Portfolio.Photo::objectKey).toList()
                + " share=" + portfolio.share();
    }
}
