package com.acttub.actingapi.feature.audition.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.acttub.actingapi.feature.audition.domain.AuditionRules;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 수집의 흐름(app.audition 「입력·출력」·「예외」). 저장소와 출처는 메모리 가짜다. */
class AuditionServiceTest {

    /** 2026-10-08 09:00 KST. */
    private static final Instant NOW = Instant.parse("2026-10-08T00:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 8);

    private final FakeSources sources = new FakeSources();
    private final MemoryRepository repository = new MemoryRepository();
    private final List<String> reported = new ArrayList<>();
    private final FailureReporter failures = new FailureReporter() {
        @Override
        public void report(Throwable failure, FailureKind kind, FailureContext context) {
            reported.add(kind + " " + context.location());
        }
    };

    private AuditionService service(boolean enabled, String sourcesCsv) {
        return new AuditionService(AuditionSettings.of(enabled, sourcesCsv), sources, repository, failures,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static AuditionPosting posting(String source, String ref, String title, String pay) {
        return new AuditionPosting(source, ref, title, "theater", pay, null, TODAY.plusDays(3), null, TODAY,
                "https://example.com/" + ref);
    }

    @Test
    @DisplayName("AUDITION_ENABLED=false 면 출처를 열지 않고 목록은 비어 있다")
    void disabledNeverTouchesTheNetwork() {
        repository.upsert(List.of(posting("otr", "1", "배우 모집", null)), NOW);
        AuditionService off = service(false, AuditionRules.DEFAULT_SOURCES);

        off.collect();
        off.collectIfStale();

        assertThat(sources.calls).isEmpty();
        assertThat(off.list().items()).isEmpty();
        assertThat(off.list().collectedAt()).isNull();
    }

    @Test
    @DisplayName("AUDITION_SOURCES 에 plfil 이 없으면(기본값) 플필 수집기가 돌지 않는다")
    void plfilIsNotReadUnlessListed() {
        service(true, AuditionRules.DEFAULT_SOURCES).collect();
        assertThat(sources.calls).containsExactly("shinsee", "emk", "sejong", "otr");

        sources.calls.clear();
        service(true, "otr,plfil").collect();
        assertThat(sources.calls).containsExactly("otr", "plfil");
    }

    @Test
    @DisplayName("출처 하나가 실패해도 나머지는 계속하고, 실패는 External Failure 로 보고한다")
    void oneSourceFailingDoesNotStopTheOthers() {
        sources.failing = "emk";
        sources.postings.put("otr", List.of(posting("otr", "7", "연극 배우 모집", "협의")));

        AuditionService.CollectResult result = service(true, AuditionRules.DEFAULT_SOURCES).collect();

        assertThat(sources.calls).containsExactly("shinsee", "emk", "sejong", "otr");
        assertThat(result.failed()).containsExactly("emk");
        assertThat(reported).containsExactly("EXTERNAL AuditionService.collect.emk");
        assertThat(repository.rows).containsKey("otr-7");
    }

    @Test
    @DisplayName("제목이나 출연료 문구에 휴대폰 번호 모양이 있는 공고는 저장하지 않는다")
    void contactLikeTextIsNeverStored() {
        sources.postings.put("otr", List.of(
                posting("otr", "1", "배우 모집 문의 010-1234-5678", null),
                posting("otr", "2", "배우 모집", "회당 5만원, 문의 01098765432"),
                posting("otr", "3", "배우 모집", "회당 5만원")));

        service(true, "otr").collect();

        assertThat(repository.rows).containsOnlyKeys("otr-3");
    }

    @Test
    @DisplayName("0건이 나온 출처는 저장소를 부르지 않는다 — 기존 행은 그대로다")
    void emptySourceKeepsExistingRows() {
        repository.upsert(List.of(posting("otr", "1", "배우 모집", null)), NOW.minusSeconds(3600));
        repository.upserts = 0;

        service(true, "otr").collect();

        assertThat(repository.upserts).isZero();
        assertThat(repository.rows).containsKey("otr-1");
        assertThat(repository.deleteCalls).isEqualTo(1);
    }

    @Test
    @DisplayName("목록은 열린 것만 마감이 가까운 순으로, collected_at 은 마지막 수집 시각이다")
    void listFiltersAndSorts() {
        repository.upsert(List.of(
                new AuditionPosting("otr", "late", "배우 모집", "theater", null, null, TODAY.plusDays(9), null, TODAY,
                        "https://example.com/late"),
                new AuditionPosting("otr", "soon", "배우 모집", "theater", null, null, TODAY, null, TODAY,
                        "https://example.com/soon"),
                new AuditionPosting("emk", "done", "오디션 공지 (완료)", "musical", null, null, null, "마감", TODAY,
                        "https://example.com/done")), NOW);

        AuditionService.AuditionList list = service(true, AuditionRules.DEFAULT_SOURCES).list();

        assertThat(list.items()).extracting(AuditionPosting::sourceRef).containsExactly("soon", "late");
        assertThat(list.collectedAt()).isEqualTo(NOW);
    }

    @Test
    @DisplayName("기동 뒤 수집은 한 번도 모으지 않았거나 12시간보다 오래됐을 때만 돈다")
    void collectIfStale() {
        AuditionService on = service(true, "otr");
        assertThat(on.collectIfStale()).isTrue();
        assertThat(sources.calls).containsExactly("otr");

        sources.calls.clear();
        repository.upsert(List.of(posting("otr", "1", "배우 모집", null)), NOW.minusSeconds(3600));
        assertThat(on.collectIfStale()).isFalse();
        assertThat(sources.calls).isEmpty();

        repository.upsert(List.of(posting("otr", "1", "배우 모집", null)), NOW.minusSeconds(13 * 3600));
        repository.lastSeen = NOW.minusSeconds(13 * 3600);
        assertThat(on.collectIfStale()).isTrue();
        assertThat(sources.calls).containsExactly("otr");
    }

    static final class FakeSources implements AuditionSources {
        final List<String> calls = new ArrayList<>();
        final Map<String, List<AuditionPosting>> postings = new LinkedHashMap<>();
        String failing;

        @Override
        public List<AuditionPosting> read(String source, LocalDate today) {
            calls.add(source);
            if (source.equals(failing)) {
                throw new IllegalStateException(source + " is down");
            }
            return postings.getOrDefault(source, List.of());
        }
    }

    static final class MemoryRepository implements AuditionRepository {
        final Map<String, AuditionPosting> rows = new LinkedHashMap<>();
        Instant lastSeen;
        int upserts;
        int deleteCalls;

        @Override
        public void upsert(List<AuditionPosting> postings, Instant now) {
            upserts++;
            postings.forEach(p -> rows.put(p.id(), p));
            lastSeen = lastSeen == null || now.isAfter(lastSeen) ? now : lastSeen;
        }

        @Override
        public List<AuditionPosting> openCandidates(LocalDate today) {
            return List.copyOf(rows.values());
        }

        @Override
        public int deleteExpired(LocalDate today) {
            deleteCalls++;
            return 0;
        }

        @Override
        public Optional<Instant> lastCollectedAt() {
            return Optional.ofNullable(lastSeen);
        }
    }
}
