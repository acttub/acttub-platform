package com.acttub.actingapi.feature.audition.adapter.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.util.List;

import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** 출처 페이지 모양이 조금 어긋났을 때: 읽을 수 없는 줄은 건너뛰고, 모두 읽을 수 없으면 고장으로 알린다. */
class AuditionParsersEdgeTest {
    static final LocalDate TODAY = LocalDate.of(2026, 10, 8);
    final ObjectMapper json = new ObjectMapper();

    static String shinseeRow(String href, String period, String posted) {
        return "<tr><td>1</td><td>" + period + "</td><td>접수중</td><td>" + posted + "</td>"
                + "<td><a href=\"" + href + "\">2027 뮤지컬 오디션</a></td></tr>";
    }

    @Test void shinseeSkipsShortRowsAndReadsSingleDatesAsNoPeriod() {
        String html = "<table>"
                + "<tr><td><a href=\"Audition.aspx?mode=v&Id=1\">짧은 줄</a></td></tr>"
                + shinseeRow("Audition.aspx?mode=v&Id=7", "26.09.01", "2026.08.30")
                + shinseeRow("Audition.aspx?mode=v", "26.09.01~26.09.30", "2026.08.30")
                + shinseeRow("Audition.aspx?mode=v&Id=8", "26.09.01~26.09.30", "2026.13.40")
                + "</table>";
        List<AuditionPosting> postings = AuditionParsers.shinsee(html);
        assertThat(postings).singleElement().satisfies(posting -> {
            assertThat(posting.sourceRef()).isEqualTo("7");
            assertThat(posting.applyStart()).isNull();
            assertThat(posting.applyEnd()).isNull();
            assertThat(posting.postedOn()).isEqualTo(LocalDate.of(2026, 8, 30));
        });
        assertThatThrownBy(() -> AuditionParsers.shinsee("<table>" + shinseeRow("Audition.aspx?mode=v&Id=8", "", "날짜 없음") + "</table>"))
                .isInstanceOf(AuditionSourceFailure.class).hasMessage("shinsee rows are unreadable — a date or id format changed");
    }

    @Test void emkRejectsAnUnparseableFeedAndSkipsItemsWithoutIdOrDate() {
        assertThatThrownBy(() -> AuditionParsers.emk("<rss><channel>")).isInstanceOf(AuditionSourceFailure.class)
                .hasMessage("emk rss is unreadable");
        String feed = "<rss><channel>"
                + "<item><title>오디션 공고 1</title><link>https://emkmusical.com/?kboard_content_redirect=11</link>"
                + "<pubDate>Tue, 08 Sep 2026 01:00:00 +0000</pubDate></item>"
                + "<item><title>오디션 공고 2</title><link>https://emkmusical.com/?p=12</link>"
                + "<pubDate>Tue, 08 Sep 2026 01:00:00 +0000</pubDate></item>"
                + "<item><title>오디션 공고 3</title><link>https://emkmusical.com/?kboard_content_redirect=13</link>"
                + "<pubDate>어제</pubDate></item>"
                + "<item><title>오디션 공고 4</title></item>"
                + "</channel></rss>";
        assertThat(AuditionParsers.emk(feed)).extracting(AuditionPosting::sourceRef).containsExactly("11");
    }

    static String sejongRow(String id, String title, String date) {
        return "<tr><td><a href=\"view.do?nttId=" + id + "\">" + title + "</a></td>"
                + (date == null ? "" : "<td class=\"line\">" + date + "</td>") + "</tr>";
    }

    @Test void sejongNeedsAPostedDateForEveryActorAudition() {
        assertThatThrownBy(() -> AuditionParsers.sejong("<table>" + sejongRow("5", "아역 오디션", null) + sejongRow("6", "배우 모집", "2026-13-01") + "</table>"))
                .isInstanceOf(AuditionSourceFailure.class).hasMessage("sejong rows are unreadable — a date or id format changed");
        assertThat(AuditionParsers.sejong("<table>" + sejongRow("5", "아역 오디션", "2026-09-01") + sejongRow("6", "배우 모집", "어제") + "</table>"))
                .extracting(AuditionPosting::sourceRef).containsExactly("5");
    }

    static String plfil(String data) {
        return "<script id=\"__NEXT_DATA__\" type=\"application/json\">{\"props\":{\"pageProps\":{\"data\":" + data + "}}}</script>";
    }

    @Test void plfilRejectsMissingOrBrokenListData() {
        assertThatThrownBy(() -> AuditionParsers.plfil("<html></html>", json)).isInstanceOf(AuditionSourceFailure.class)
                .hasMessage("plfil list data is missing");
        assertThatThrownBy(() -> AuditionParsers.plfil(plfil("{\"list\":{}}"), json)).hasMessage("plfil list data is missing");
        assertThatThrownBy(() -> AuditionParsers.plfil("<script id=\"__NEXT_DATA__\" type=\"application/json\">{broken</script>", json))
                .isInstanceOf(AuditionSourceFailure.class).hasMessage("plfil list data is unreadable");
    }

    @Test void plfilReadsPayRangesDatesAndSkipsIncompleteCastings() {
        var page = AuditionParsers.plfil(plfil("""
                {"totalPage":0,"list":[
                  {"id":"1","title":"단편 주연","createdAt":"2026-10-01T15:30:00Z","artCategoryName":"단편영화",
                   "minReward":10,"maxReward":30,"canNego":true,"isRecruiting":true,"castingEndDate":"2026-10-13T23:59:59+00:00"},
                  {"id":"2","title":"광고 모델","createdAt":"2026-10-01T00:00:00+09:00","artCategoryName":"새 분야",
                   "minReward":50,"maxReward":null},
                  {"id":"3","title":"","createdAt":"2026-10-01T00:00:00Z"},
                  {"id":"4","title":"날짜 깨짐","createdAt":"어제"},
                  {"id":"5","title":"비공개","isPrivate":true}]}
                """), json);
        assertThat(page.totalPages()).isEqualTo(1);
        assertThat(page.postings()).hasSize(2);
        AuditionPosting first = page.postings().get(0);
        assertThat(first.category()).isEqualTo("short_film");
        assertThat(first.payText()).isEqualTo("10~30만원 (협의 가능)");
        assertThat(first.postedOn()).isEqualTo(LocalDate.of(2026, 10, 2));
        assertThat(first.applyEnd()).isEqualTo(LocalDate.of(2026, 10, 14));
        assertThat(first.statusText()).isEqualTo("모집중");
        AuditionPosting second = page.postings().get(1);
        assertThat(second.category()).isEqualTo("other");
        assertThat(second.payText()).isEqualTo("50만원");
        assertThat(second.statusText()).isEqualTo("마감");
        assertThat(second.applyEnd()).isNull();
    }

    static String otrRow(String vid, String title, String posted) {
        return "<tr><td>1</td><td>" + title + "</td><td>작성자</td><td>회당 10만원</td><td>2026-10-30</td><td>" + posted + "</td>"
                + "<td><a href=\"?vid=" + vid + "\">보기</a></td></tr>";
    }

    @Test void otrSkipsNoticesSalesAndShortRowsAndReadsTodaysClockAsToday() {
        String html = "<table>"
                + "<tr><td><a href=\"?vid=1\">짧은 줄</a></td></tr>"
                + otrRow("2", "[공지사항] 게시판 이용 안내", "2026-10-01")
                + otrRow("3", "[연극] 극장 대관 합니다", "2026-10-01")
                + otrRow("4", "독립 장편 배우 모집", "15:54")
                + otrRow("5", "[웹예능] 출연자 모집", "2026-10-02")
                + otrRow("6", "[연극] 날짜 깨짐", "어제")
                + "</table>";
        List<AuditionPosting> postings = AuditionParsers.otr(html, TODAY);
        assertThat(postings).extracting(AuditionPosting::sourceRef).containsExactly("4", "5");
        assertThat(postings.get(0).postedOn()).isEqualTo(TODAY);
        assertThat(postings.get(0).category()).isEqualTo("other");
        assertThat(postings.get(1).category()).isEqualTo("other");
        assertThat(postings.get(1).payText()).isEqualTo("회당 10만원");
    }
}
