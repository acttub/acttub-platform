package com.acttub.actingapi.feature.audition.domain;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * 오디션 공고의 규칙(app.audition 「상태」·「규칙·제약」). 열림은 행에 두지 않고 읽을 때 여기서 계산한다. 출처·분야 값
 * 목록은 V36 의 CHECK 와 같은 선이다(AuditionSchemaMigrationTest).
 */
public final class AuditionRules {

    /** 접수 기간·게시일·"오늘" 은 모두 한국 날짜다. */
    public static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** 출처 코드 → 화면에 쓰는 이름. 등급과 근거는 ADR-034. */
    public static final Map<String, String> SOURCES;

    static {
        Map<String, String> sources = new LinkedHashMap<>();
        sources.put("shinsee", "신시컴퍼니");
        sources.put("emk", "EMK뮤지컬컴퍼니");
        sources.put("sejong", "세종문화회관");
        sources.put("plfil", "플필");
        sources.put("otr", "OTR");
        SOURCES = java.util.Collections.unmodifiableMap(sources);
    }

    public static final List<String> CATEGORIES = List.of(
            "film", "short_film", "drama", "web_drama", "short_form", "commercial", "music_video", "theater",
            "musical", "agency_open", "other");

    /** {@code AUDITION_SOURCES} 의 기본값. 경쟁 캐스팅 플랫폼(plfil)은 기본에서 뺀다(ADR-034). */
    public static final String DEFAULT_SOURCES = "shinsee,emk,sejong,otr";

    /** 마감일이 없는 공고가 열려 있는 날 수(게시일부터). */
    public static final int OPEN_WITHOUT_END_DAYS = 45;

    /** 마감일이 지난 뒤 행을 남겨 두는 날 수. */
    public static final int KEEP_AFTER_END_DAYS = 30;

    /** 마감일이 없는 행을 게시일부터 남겨 두는 날 수. */
    public static final int KEEP_WITHOUT_END_DAYS = 180;

    /** 상태 문구 속 마감 표시. 상태 칸은 짧은 원문 문구라 어디에 있든 표시로 본다. */
    private static final Pattern CLOSED_STATUS = Pattern.compile("마감|완료|종료");

    /**
     * 제목 속 마감 표시. 제목에는 "10/20 마감" 같은 마감일 안내가 흔해서 괄호로 묶은 표시만 본다 —
     * {@code (완료)}·{@code [마감]}·{@code (모집마감)}·{@code 【접수 종료】}.
     */
    private static final Pattern CLOSED_TITLE =
            Pattern.compile("[(\\[【〈]\\s*(?:모집|접수|채용|오디션)?\\s*(?:마감|완료|종료)\\s*[)\\]】〉]");

    /**
     * 이메일·휴대폰 번호 모양. 번호는 앞뒤가 숫자가 아니어야 한다 — 기사 주소 속 긴 숫자열에 걸리지 않게.
     * {@code \w} 는 파이썬 수집기와 같이 유니코드 글자까지 본다.
     */
    private static final Pattern PERSONAL_CONTACT = Pattern.compile(
            "[\\w.+-]+@[\\w-]+\\.[\\w.]+|(?<!\\d)01[016789][-\\s.]?\\d{3,4}[-\\s.]?\\d{4}(?!\\d)",
            Pattern.UNICODE_CHARACTER_CLASS);

    /** 마감일 오름차순(없는 것은 뒤), 게시일 내림차순, 마지막으로 id. */
    public static final Comparator<AuditionPosting> ORDER = Comparator
            .comparing(AuditionPosting::applyEnd, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(AuditionPosting::postedOn, Comparator.nullsLast(Comparator.reverseOrder()))
            .thenComparing(AuditionPosting::id);

    private AuditionRules() {
    }

    public static String sourceName(String source) {
        return SOURCES.get(source);
    }

    /** 지금 지원할 수 있는가. {@code today} 는 한국 날짜다. */
    public static boolean isOpen(AuditionPosting posting, LocalDate today) {
        if (hasClosedMarker(posting)) {
            return false;
        }
        if (posting.applyEnd() != null) {
            return !posting.applyEnd().isBefore(today);
        }
        return posting.postedOn() != null && !posting.postedOn().isBefore(openPostedSince(today));
    }

    public static boolean hasClosedMarker(AuditionPosting posting) {
        return (posting.statusText() != null && CLOSED_STATUS.matcher(posting.statusText()).find())
                || (posting.title() != null && CLOSED_TITLE.matcher(posting.title()).find());
    }

    /** 마감일이 없는 공고가 열려 있으려면 게시일이 이 날 이후여야 한다. */
    public static LocalDate openPostedSince(LocalDate today) {
        return today.minusDays(OPEN_WITHOUT_END_DAYS);
    }

    /** 마감일이 이 날보다 앞이면 지운다. */
    public static LocalDate deleteEndedBefore(LocalDate today) {
        return today.minusDays(KEEP_AFTER_END_DAYS);
    }

    /** 마감일이 없고 게시일이 이 날보다 앞이면 지운다. */
    public static LocalDate deletePostedBefore(LocalDate today) {
        return today.minusDays(KEEP_WITHOUT_END_DAYS);
    }

    /** 저장하는 글자 칸 어디에든 이메일·휴대폰 번호 모양이 있으면 그 공고는 버린다. */
    public static boolean containsPersonalContact(AuditionPosting posting) {
        return Stream.of(posting.title(), posting.payText(), posting.statusText(), posting.sourceUrl())
                .filter(Objects::nonNull)
                .anyMatch(text -> PERSONAL_CONTACT.matcher(text).find());
    }

    /** 쉼표 목록에서 아는 출처 코드만 적힌 순서대로 한 번씩. */
    public static List<String> enabledSources(String csv) {
        List<String> enabled = new ArrayList<>();
        if (csv == null) {
            return enabled;
        }
        Arrays.stream(csv.split(","))
                .map(String::trim)
                .filter(SOURCES::containsKey)
                .filter(code -> !enabled.contains(code))
                .forEach(enabled::add);
        return List.copyOf(enabled);
    }

    /** 제목만으로 분야를 짐작한다(분야 칸이 없는 공식 출처). */
    public static String guessCategory(String title) {
        if (title.contains("뮤지컬")) {
            return "musical";
        }
        if (title.contains("연극")) {
            return "theater";
        }
        return "other";
    }
}
