package com.acttub.actingapi.feature.audition.adapter.source;

import static com.acttub.actingapi.feature.audition.adapter.source.AuditionParsersTest.fixture;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 출처마다 어느 주소를 몇 쪽 여는지와 요청 사이의 간격. 네트워크 대신 fixture 를 돌려준다. */
class HttpAuditionSourcesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 8);

    private final List<URI> fetched = new ArrayList<>();
    private final List<Duration> pauses = new ArrayList<>();

    private HttpAuditionSources sources(String fixtureName) {
        return new HttpAuditionSources(uri -> {
            fetched.add(uri);
            return fixture(fixtureName);
        }, pauses::add, new ObjectMapper());
    }

    @Test
    @DisplayName("OTR 은 1~3쪽을 2초 간격으로 열고, 쪽마다 되풀이되는 고정글은 한 번만 남긴다")
    void otrReadsThreePagesWithGaps() {
        List<AuditionPosting> postings = sources("otr.html").read("otr", TODAY);

        assertThat(fetched).extracting(URI::toString).containsExactly(
                "https://otr.co.kr/audition/?mode=list&board_page=1",
                "https://otr.co.kr/audition/?mode=list&board_page=2",
                "https://otr.co.kr/audition/?mode=list&board_page=3");
        assertThat(pauses).containsExactly(Duration.ofSeconds(2), Duration.ofSeconds(2));
        assertThat(postings).extracting(AuditionPosting::sourceRef).doesNotHaveDuplicates();
    }

    @Test
    @DisplayName("플필은 목록 페이지만, 전체 쪽 수와 3쪽 중 작은 만큼 연다 — 상세(/casting/{id})는 열지 않는다")
    void plfilReadsListPagesOnly() {
        sources("plfil.html").read("plfil", TODAY);

        assertThat(fetched).extracting(URI::toString).containsExactly(
                "https://plfil.com/casting", "https://plfil.com/casting?page=2", "https://plfil.com/casting?page=3");
        assertThat(fetched).noneMatch(uri -> uri.getPath().matches("/casting/\\d+"));
        assertThat(pauses).hasSize(2);
    }

    @Test
    @DisplayName("공식 출처 셋은 목록 하나씩만 연다")
    void officialSourcesReadOnePage() {
        sources("shinsee.html").read("shinsee", TODAY);
        sources("emk.xml").read("emk", TODAY);
        sources("sejong.html").read("sejong", TODAY);

        assertThat(fetched).extracting(URI::toString).containsExactly(
                "https://www.iseensee.com/Home/Community/Audition.aspx",
                "https://emkmusical.com/wp-content/plugins/kboard/rss.php",
                "https://www.sejongpac.or.kr/portal/bbs/B0000065/list.do?menuNo=200571");
        assertThat(pauses).isEmpty();
    }

    @Test
    @DisplayName("User-Agent 는 ActtubBot 과 서비스 주소를 밝힌다")
    void userAgentNamesTheBot() {
        assertThat(HttpAuditionSources.USER_AGENT)
                .isEqualTo("Mozilla/5.0 (compatible; ActtubBot/1.0; +https://acttub.com)");
    }

    @Test
    @DisplayName("모르는 출처 코드는 거부한다")
    void unknownSource() {
        assertThatThrownBy(() -> sources("otr.html").read("filmmakers", TODAY))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(fetched).isEmpty();
    }
}
