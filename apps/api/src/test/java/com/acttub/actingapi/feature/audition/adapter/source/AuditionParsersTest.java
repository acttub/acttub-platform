package com.acttub.actingapi.feature.audition.adapter.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;

import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.acttub.actingapi.platform.observability.ExternalFailure;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 출처별 목록 조각(src/test/resources/audition, 2026-10-08 실제 페이지를 잘라 작성자·연락처를 지운 것)을 넣으면 기대한
 * 공고가 나온다(app.audition 「검증 방법」). 플필의 id 9001~9003 과 OTR 의 vid=99901 은 경계를 보려고 더한 합성 행이다.
 */
class AuditionParsersTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 8);

    @Test
    @DisplayName("신시: 표의 제목·신청기간·상태·등록일을 읽고 분야는 제목에서 짐작한다")
    void shinsee() {
        List<AuditionPosting> postings = AuditionParsers.shinsee(fixture("shinsee.html"));

        assertThat(postings).hasSize(10);
        assertThat(postings.get(0)).isEqualTo(new AuditionPosting("shinsee", "66", "2027 뮤지컬 <아이다> 공개 오디션",
                "musical", null, LocalDate.of(2026, 8, 20), LocalDate.of(2026, 9, 21), "접수마감",
                LocalDate.of(2026, 8, 19), "https://www.iseensee.com/Home/Community/Audition.aspx?mode=v&Id=66"));
        assertThat(postings.get(1).title()).isEqualTo("2027 연극 <푸르른 날에> 공개 오디션");
        assertThat(postings.get(1).category()).isEqualTo("theater");
        assertThat(postings).extracting(AuditionPosting::sourceRef).doesNotHaveDuplicates();
    }

    @Test
    @DisplayName("EMK: RSS 에서 '오디션' 제목만, 엔티티를 풀고 게시일은 KST 날짜, 두 게시판에 겹친 같은 제목은 하나로")
    void emk() {
        List<AuditionPosting> postings = AuditionParsers.emk(fixture("emk.xml"));

        assertThat(postings).extracting(AuditionPosting::sourceRef).containsExactly("16354", "16249", "14954", "13183");
        assertThat(postings.get(0)).isEqualTo(new AuditionPosting("emk", "16354",
                "2027 EMK PRODUCTION <모차르트!> 아역 오디션 공지", "musical", null, null, null, null,
                LocalDate.of(2026, 9, 8), "https://emkmusical.com/?kboard_content_redirect=16354"));
        // 2026-03-09 15:56 UTC 는 한국 날짜로 3월 10일이다.
        assertThat(postings.get(2).postedOn()).isEqualTo(LocalDate.of(2026, 3, 10));
        assertThat(postings.get(3).title()).endsWith("(완료)");
        assertThat(postings.get(3).statusText()).isEqualTo("마감");
        assertThat(postings).noneMatch(p -> p.title().contains("직원 채용"));
    }

    @Test
    @DisplayName("세종문화회관: 「안내원 모집」·직원·임원·지휘자 채용은 버리고 「아역 오디션」만 남긴다")
    void sejongKeepsOnlyActorAuditions() {
        List<AuditionPosting> postings = AuditionParsers.sejong(fixture("sejong.html"));

        assertThat(postings).containsExactly(new AuditionPosting("sejong", "50066",
                "2026 서울시뮤지컬단 뮤지컬 <크리스마스 캐럴> 아역 오디션 공고", "musical", null, null, null, null,
                LocalDate.of(2026, 7, 8),
                "https://www.sejongpac.or.kr/portal/bbs/B0000065/view.do?nttId=50066&menuNo=200571"));
    }

    @Test
    @DisplayName("플필: 목록 JSON 의 사실 칸만, 마감일은 UTC→KST 날짜, 비공개 공고는 버린다")
    void plfil() {
        AuditionParsers.PlfilPage page = AuditionParsers.plfil(fixture("plfil.html"), new ObjectMapper());

        assertThat(page.totalPages()).isEqualTo(3);
        List<AuditionPosting> postings = page.postings();
        assertThat(postings).extracting(AuditionPosting::sourceRef)
                .containsExactly("4423", "4420", "4415", "4412", "9002", "9003");
        assertThat(postings.get(0)).isEqualTo(new AuditionPosting("plfil", "4423",
                "건강 마사지건 제품 SNS광고 30대 인플 이미지 여성 배우님 모집", "other", "30만원 (협의 가능)", null,
                LocalDate.of(2026, 10, 14), "모집중", LocalDate.of(2026, 10, 8), "https://plfil.com/casting/4423"));
        assertThat(postings.get(1).category()).isEqualTo("commercial");
        assertThat(postings.get(1).payText()).isEqualTo("30만원");
        assertThat(postings.get(2).category()).isEqualTo("drama");
        assertThat(postings.get(2).payText()).isEqualTo("40~60만원");
        assertThat(postings.get(4)).satisfies(closed -> {
            assertThat(closed.category()).isEqualTo("short_film");
            assertThat(closed.payText()).isNull();
            assertThat(closed.applyEnd()).isNull();
            assertThat(closed.statusText()).isEqualTo("마감");
        });
        // 10-07T16:30Z 는 한국 날짜로 10월 8일, 10-19T15:00Z 는 10월 20일이다.
        assertThat(postings.get(5).postedOn()).isEqualTo(LocalDate.of(2026, 10, 8));
        assertThat(postings.get(5).applyEnd()).isEqualTo(LocalDate.of(2026, 10, 20));
        assertThat(postings.get(5).category()).isEqualTo("web_drama");
        assertThat(postings.get(5).payText()).isEqualTo("50~80만원 (협의 가능)");
    }

    @Test
    @DisplayName("OTR: 제목·분야·페이·마감·게시일만 읽고, 「극장 대관」 글과 게시판 공지사항은 버린다")
    void otr() {
        List<AuditionPosting> postings = AuditionParsers.otr(fixture("otr.html"), TODAY);

        assertThat(postings).extracting(AuditionPosting::sourceRef)
                .doesNotContain("99901", "19279", "19260", "16436", "13221", "2975")
                .contains("22129", "22430", "22418");
        assertThat(postings).noneMatch(p -> p.title().contains("대관"));
        assertThat(postings.get(0)).isEqualTo(new AuditionPosting("otr", "22129",
                "[뮤지컬] 가족뮤지컬 <고양이 탐정 조르바> 리딩쇼케이스 오디션 공고", "musical", "협의", null,
                LocalDate.of(2026, 9, 30), null, LocalDate.of(2026, 9, 7), "https://otr.co.kr/audition/?vid=22129"));
        AuditionPosting rest = byRef(postings, "22034");
        assertThat(rest.category()).isEqualTo("theater");
        assertThat(rest.payText()).isEqualTo("회당 5만원 이상(경력에 따른 차등 지급)");
    }

    @Test
    @DisplayName("OTR: 오늘 올라온 글은 게시일 칸이 시각뿐이라 오늘 날짜로, 마감 칸이 비면 null 로 읽는다")
    void otrTodayRowsShowOnlyATime() {
        List<AuditionPosting> postings = AuditionParsers.otr(fixture("otr.html"), TODAY);

        AuditionPosting today = byRef(postings, "22430");
        assertThat(today.postedOn()).isEqualTo(TODAY);
        assertThat(today.applyEnd()).isEqualTo(LocalDate.of(2026, 10, 17));
        AuditionPosting noEnd = byRef(postings, "22425");
        assertThat(noEnd.applyEnd()).isNull();
        assertThat(noEnd.postedOn()).isEqualTo(TODAY);
        assertThat(noEnd.category()).isEqualTo("other");
    }

    @Test
    @DisplayName("작성자 칸은 어떤 출처에서도 공고 칸으로 들어오지 않는다")
    void authorsNeverLeakIntoFields() {
        for (AuditionPosting posting : AuditionParsers.otr(fixture("otr.html"), TODAY)) {
            assertThat(List.of(posting.title(), String.valueOf(posting.payText()), String.valueOf(posting.statusText())))
                    .noneMatch(text -> text.contains("작성자"));
        }
    }

    @Test
    @DisplayName("목록 표를 하나도 못 찾으면(구조가 바뀜) 0건이 아니라 바깥 의존 실패로 끝난다")
    void structureChangeIsAnExternalFailure() {
        String changed = "<html><body><div>점검 중</div></body></html>";
        for (Runnable parse : List.<Runnable>of(
                () -> AuditionParsers.shinsee(changed),
                () -> AuditionParsers.sejong(changed),
                () -> AuditionParsers.otr(changed, TODAY),
                () -> AuditionParsers.plfil(changed, new ObjectMapper()),
                () -> AuditionParsers.emk("<rss><channel></channel></rss>"))) {
            assertThatThrownBy(parse::run).isInstanceOf(ExternalFailure.class);
        }
    }

    private static AuditionPosting byRef(List<AuditionPosting> postings, String ref) {
        return postings.stream().filter(p -> p.sourceRef().equals(ref)).findFirst().orElseThrow();
    }

    static String fixture(String name) {
        try (InputStream in = AuditionParsersTest.class.getResourceAsStream("/audition/" + name)) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
