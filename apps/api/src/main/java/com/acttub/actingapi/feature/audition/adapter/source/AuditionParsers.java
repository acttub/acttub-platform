package com.acttub.actingapi.feature.audition.adapter.source;

import java.io.StringReader;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;

import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.acttub.actingapi.feature.audition.domain.AuditionRules;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.parser.Parser;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

/**
 * 출처별 목록 페이지·RSS → 공고 목록. 네트워크를 모르는 순수 함수다(파이썬 수집기 {@code collect.py} 를 옮김).
 *
 * <p>읽는 것은 목록의 사실 칸뿐이다 — 작성자·담당자 칸은 읽지 않고, 상세 페이지 주소는 {@code source_url} 로 적기만
 * 한다. 목록 행을 하나도 못 찾으면 0건이 아니라 {@link AuditionSourceFailure} 다(구조가 바뀐 것을 조용히 넘기지
 * 않는다). 행은 있는데 조건에 맞는 공고가 없는 것은 빈 목록이다.
 */
final class AuditionParsers {

    private AuditionParsers() {
    }

    // ─── 신시컴퍼니 ──────────────────────────────────────────────────────

    private static final Pattern SHORT_DATE = Pattern.compile("(\\d{2})\\.(\\d{2})\\.(\\d{2})");
    private static final Pattern DOTTED_DATE = Pattern.compile("(\\d{4})\\.(\\d{1,2})\\.(\\d{1,2})");

    static List<AuditionPosting> shinsee(String html) {
        Document doc = Jsoup.parse(html);
        List<AuditionPosting> out = new ArrayList<>();
        int rows = 0;
        for (Element tr : doc.select("tr")) {
            Element a = tr.selectFirst("a[href*=Audition.aspx?mode=v]");
            List<Element> tds = tr.select("> td");
            if (a == null || tds.size() < 4) {
                continue;
            }
            rows++;
            String ref = group(Pattern.compile("Id=(\\d+)"), a.attr("href"));
            if (ref == null) {
                continue;
            }
            String title = a.text().strip();
            Matcher period = SHORT_DATE.matcher(tds.get(1).text());
            List<LocalDate> dates = new ArrayList<>();
            while (period.find()) {
                dates.add(LocalDate.of(2000 + Integer.parseInt(period.group(1)), Integer.parseInt(period.group(2)),
                        Integer.parseInt(period.group(3))));
            }
            LocalDate posted = dotted(tds.get(3).text());
            if (posted == null) {
                continue;
            }
            out.add(new AuditionPosting("shinsee", ref, title, AuditionRules.guessCategory(title), null,
                    dates.size() == 2 ? dates.get(0) : null, dates.size() == 2 ? dates.get(1) : null,
                    blankToNull(tds.get(2).text()), posted,
                    "https://www.iseensee.com/Home/Community/Audition.aspx?mode=v&Id=" + ref));
        }
        requireRows("shinsee", rows);
        return unique(out);
    }

    // ─── EMK (KBoard RSS) ───────────────────────────────────────────────

    static List<AuditionPosting> emk(String xml) {
        NodeList items;
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setExpandEntityReferences(false);
            items = factory.newDocumentBuilder().parse(new InputSource(new StringReader(xml)))
                    .getElementsByTagName("item");
        } catch (Exception unreadable) {
            throw new AuditionSourceFailure("emk rss is unreadable", unreadable);
        }
        requireRows("emk", items.getLength());
        List<AuditionPosting> out = new ArrayList<>();
        Set<String> titles = new HashSet<>();
        for (int i = 0; i < items.getLength(); i++) {
            org.w3c.dom.Element item = (org.w3c.dom.Element) items.item(i);
            String title = Parser.unescapeEntities(text(item, "title"), false).strip();
            if (!title.contains("오디션")) {
                continue;
            }
            String link = text(item, "link").strip();
            String ref = group(Pattern.compile("redirect=(\\d+)"), link);
            LocalDate posted = rfc1123(text(item, "pubDate"));
            // 같은 공지가 두 게시판(Notice·Notice - Audition)에 따로 올라온다. 새것(앞)만 남긴다.
            if (ref == null || posted == null || !titles.add(title)) {
                continue;
            }
            out.add(new AuditionPosting("emk", ref, title, "musical", null, null, null,
                    title.contains("(완료)") ? "마감" : null, posted, link));
        }
        return unique(out);
    }

    // ─── 세종문화회관 채용공고 게시판 ─────────────────────────────────────

    static final Pattern SEJONG_INCLUDE = Pattern.compile("오디션|배우|아역|연기단원|단원\\s*(공개)?(모집|채용)");

    /**
     * 같은 게시판에 직원·안내원·임원·지휘자 채용이 섞여 올라온다. 국악단·합창단·무용단의 단원 모집도 "단원 모집" 에
     * 걸리지만 배우 공고가 아니라 함께 뺀다.
     */
    static final Pattern SEJONG_EXCLUDE =
            Pattern.compile("직책단원|안내원|임원|직원|사무|지휘|국악|합창|무용|관현악|오케스트라");

    static List<AuditionPosting> sejong(String html) {
        Document doc = Jsoup.parse(html);
        List<AuditionPosting> out = new ArrayList<>();
        int rows = 0;
        for (Element tr : doc.select("tr")) {
            Element a = tr.selectFirst("a[href*=view.do?nttId=]");
            if (a == null) {
                continue;
            }
            rows++;
            String title = a.text().strip();
            if (!SEJONG_INCLUDE.matcher(title).find() || SEJONG_EXCLUDE.matcher(title).find()) {
                continue;
            }
            String ref = group(Pattern.compile("nttId=(\\d+)"), a.attr("href"));
            Element line = tr.selectFirst("td.line");
            LocalDate posted = line == null ? null : isoDate(line.text());
            if (ref == null || posted == null) {
                continue;
            }
            out.add(new AuditionPosting("sejong", ref, title, AuditionRules.guessCategory(title), null, null, null,
                    null, posted,
                    "https://www.sejongpac.or.kr/portal/bbs/B0000065/view.do?nttId=" + ref + "&menuNo=200571"));
        }
        requireRows("sejong", rows);
        return unique(out);
    }

    // ─── 플필 (목록 페이지의 __NEXT_DATA__) ───────────────────────────────

    static final Map<String, String> PLFIL_CATEGORY = Map.ofEntries(
            Map.entry("장편상업영화", "film"), Map.entry("장편독립영화", "film"), Map.entry("단편영화", "short_film"),
            Map.entry("TV/OTT", "drama"), Map.entry("숏폼드라마", "short_form"), Map.entry("웹드라마", "web_drama"),
            Map.entry("CF", "commercial"), Map.entry("뮤직비디오", "music_video"), Map.entry("기획사", "agency_open"),
            Map.entry("연극", "theater"), Map.entry("뮤지컬", "musical"), Map.entry("기타", "other"));

    record PlfilPage(List<AuditionPosting> postings, int totalPages) {
    }

    /**
     * 목록의 사실 칸만 읽는다. 담당자·감독·썸네일은 버린다. 상세 페이지({@code /casting/{id}})는 열지 않는다 —
     * 비로그인 HTML 의 {@code __NEXT_DATA__} 에 담당자 이름·이메일·전화가 들어 있다(2026-10-08 확인).
     */
    static PlfilPage plfil(String html, ObjectMapper json) {
        Element script = Jsoup.parse(html).getElementById("__NEXT_DATA__");
        JsonNode data;
        try {
            data = script == null ? null : json.readTree(script.data()).path("props").path("pageProps").path("data");
        } catch (Exception unreadable) {
            throw new AuditionSourceFailure("plfil list data is unreadable", unreadable);
        }
        if (data == null || !data.path("list").isArray()) {
            throw new AuditionSourceFailure("plfil list data is missing");
        }
        List<AuditionPosting> out = new ArrayList<>();
        for (JsonNode c : data.path("list")) {
            if (c.path("isPrivate").asBoolean(false) || !c.hasNonNull("id") || !c.hasNonNull("createdAt")) {
                continue;
            }
            String ref = c.path("id").asText();
            String title = c.path("title").asText("").strip();
            LocalDate posted = kstDate(c.path("createdAt").asText());
            if (title.isEmpty() || posted == null) {
                continue;
            }
            out.add(new AuditionPosting("plfil", ref, title,
                    PLFIL_CATEGORY.getOrDefault(c.path("artCategoryName").asText(""), "other"), plfilPay(c), null,
                    c.hasNonNull("castingEndDate") ? kstDate(c.path("castingEndDate").asText()) : null,
                    c.path("isRecruiting").asBoolean(false) ? "모집중" : "마감",
                    posted, "https://plfil.com/casting/" + ref));
        }
        int pages = Math.max(1, data.path("totalPage").asInt(1));
        return new PlfilPage(unique(out), pages);
    }

    private static String plfilPay(JsonNode c) {
        if (!c.hasNonNull("minReward")) {
            return null;
        }
        JsonNode lo = c.path("minReward");
        JsonNode hi = c.path("maxReward");
        String pay = !hi.isNumber() || lo.decimalValue().compareTo(hi.decimalValue()) == 0
                ? lo.asText() + "만원"
                : lo.asText() + "~" + hi.asText() + "만원";
        return c.path("canNego").asBoolean(false) ? pay + " (협의 가능)" : pay;
    }

    // ─── OTR 오디션 게시판 ───────────────────────────────────────────────

    static final Map<String, String> OTR_CATEGORY = Map.of(
            "연극", "theater", "뮤지컬", "musical", "영화", "film", "TV방송", "drama", "인터넷플랫폼", "web_drama",
            "가수", "other", "모델", "commercial", "기획사", "agency_open");

    /** 오디션 게시판에 섞여 올라오는 대관·매매·홍보 글. */
    static final Pattern OTR_NOT_AUDITION = Pattern.compile("대관|매수|매매|양도|임대|판매|홍보|광고문의");

    /** 게시판 운영 공지(고정글). 공고가 아니다. */
    private static final String OTR_BOARD_NOTICE = "공지사항";

    private static final Pattern OTR_CATEGORY_PREFIX = Pattern.compile("^\\[([^\\]]+)\\]");
    private static final Pattern CLOCK = Pattern.compile("^\\d{1,2}:\\d{2}$");

    /**
     * 목록의 제목·분야·페이·마감·게시일만. 작성자 칸(3번째)은 개인 이름이 섞여 있어 읽지 않는다. 오늘 올라온 글은
     * 게시일 칸이 {@code 15:54} 같은 시각뿐이라 {@code today}(KST) 로 읽는다.
     */
    static List<AuditionPosting> otr(String html, LocalDate today) {
        Document doc = Jsoup.parse(html);
        List<AuditionPosting> out = new ArrayList<>();
        int rows = 0;
        for (Element tr : doc.select("tr")) {
            Element a = tr.selectFirst("a[href*=vid=]");
            List<Element> tds = tr.select("> td");
            if (a == null || tds.size() < 6) {
                continue;
            }
            rows++;
            String ref = group(Pattern.compile("vid=(\\d+)"), a.attr("href"));
            String title = tds.get(1).text().strip();
            String category = group(OTR_CATEGORY_PREFIX, title);
            if (ref == null || title.isEmpty() || OTR_BOARD_NOTICE.equals(category)
                    || OTR_NOT_AUDITION.matcher(title).find()) {
                continue;
            }
            String postedText = tds.get(5).text().strip();
            LocalDate posted = CLOCK.matcher(postedText).matches() ? today : isoDate(postedText);
            if (posted == null) {
                continue;
            }
            out.add(new AuditionPosting("otr", ref, title,
                    category == null ? "other" : OTR_CATEGORY.getOrDefault(category, "other"),
                    blankToNull(tds.get(3).text()), null, isoDate(tds.get(4).text()), null, posted,
                    "https://otr.co.kr/audition/?vid=" + ref));
        }
        requireRows("otr", rows);
        return unique(out);
    }

    // ─── 공통 ───────────────────────────────────────────────────────────

    private static void requireRows(String source, int rows) {
        if (rows == 0) {
            throw new AuditionSourceFailure(source + " list has no rows — the page structure changed");
        }
    }

    /** 고정글이 여러 쪽에 되풀이되므로 원문 번호가 같으면 앞의 것만. */
    static List<AuditionPosting> unique(List<AuditionPosting> postings) {
        Map<String, AuditionPosting> byRef = new LinkedHashMap<>();
        postings.forEach(p -> byRef.putIfAbsent(p.sourceRef(), p));
        return List.copyOf(byRef.values());
    }

    private static String group(Pattern pattern, String text) {
        Matcher m = pattern.matcher(text);
        return m.find() ? m.group(1) : null;
    }

    private static String blankToNull(String text) {
        String stripped = text == null ? "" : text.strip();
        return stripped.isEmpty() ? null : stripped;
    }

    private static String text(org.w3c.dom.Element item, String tag) {
        NodeList nodes = item.getElementsByTagName(tag);
        return nodes.getLength() == 0 ? "" : nodes.item(0).getTextContent();
    }

    private static LocalDate isoDate(String text) {
        String stripped = text == null ? "" : text.strip();
        try {
            return stripped.matches("\\d{4}-\\d{2}-\\d{2}") ? LocalDate.parse(stripped) : null;
        } catch (DateTimeParseException invalid) {
            return null;
        }
    }

    private static LocalDate dotted(String text) {
        Matcher m = DOTTED_DATE.matcher(text);
        if (!m.find()) {
            return null;
        }
        try {
            return LocalDate.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)),
                    Integer.parseInt(m.group(3)));
        } catch (java.time.DateTimeException invalid) {
            return null;
        }
    }

    private static LocalDate rfc1123(String text) {
        try {
            return ZonedDateTime.parse(text.strip(), DateTimeFormatter.RFC_1123_DATE_TIME)
                    .withZoneSameInstant(AuditionRules.KST).toLocalDate();
        } catch (DateTimeParseException invalid) {
            return null;
        }
    }

    /** 플필의 시각은 UTC 다. 화면의 날짜는 그것을 한국 날짜로 바꾼 것이다(10-13T23:59:59Z → 10-14). */
    private static LocalDate kstDate(String isoInstant) {
        try {
            return OffsetDateTime.parse(isoInstant).atZoneSameInstant(AuditionRules.KST).toLocalDate();
        } catch (DateTimeParseException invalid) {
            try {
                return Instant.parse(isoInstant).atZone(AuditionRules.KST).toLocalDate();
            } catch (DateTimeParseException alsoInvalid) {
                return null;
            }
        }
    }
}
