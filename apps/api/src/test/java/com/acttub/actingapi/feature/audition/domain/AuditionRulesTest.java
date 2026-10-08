package com.acttub.actingapi.feature.audition.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** app.audition 「상태」·「규칙·제약」의 순수 규칙. */
class AuditionRulesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 8);

    private static AuditionPosting posting(String title, String pay, LocalDate end, String status, LocalDate posted) {
        return new AuditionPosting("otr", "1", title, "theater", pay, null, end, status, posted,
                "https://otr.co.kr/audition/?vid=1");
    }

    @Test
    @DisplayName("마감일이 있으면 오늘(KST)까지 열려 있고, 어제 끝난 것은 닫혀 있다")
    void openUntilTheEndDateInclusive() {
        assertThat(AuditionRules.isOpen(posting("배우 모집", null, TODAY, null, TODAY.minusDays(100)), TODAY)).isTrue();
        assertThat(AuditionRules.isOpen(posting("배우 모집", null, TODAY.minusDays(1), null, TODAY), TODAY)).isFalse();
    }

    @Test
    @DisplayName("상태 문구나 제목에 마감 표시가 있으면 마감일이 남아 있어도 닫혀 있다")
    void closedMarkersWin() {
        assertThat(AuditionRules.isOpen(posting("배우 모집", null, TODAY.plusDays(5), "접수마감", TODAY), TODAY)).isFalse();
        assertThat(AuditionRules.isOpen(posting("<몬테크리스토> 오디션 공지 (완료)", null, null, null, TODAY), TODAY))
                .isFalse();
        assertThat(AuditionRules.isOpen(posting("[마감] 단편영화 조연", null, TODAY.plusDays(5), null, TODAY), TODAY))
                .isFalse();
        assertThat(AuditionRules.isOpen(posting("배우 모집", null, TODAY.plusDays(5), "모집 종료", TODAY), TODAY))
                .isFalse();
        assertThat(AuditionRules.isOpen(posting("배우 모집", null, TODAY.plusDays(5), "모집중", TODAY), TODAY)).isTrue();
    }

    @Test
    @DisplayName("제목 속 마감일 안내(괄호 밖의 '10/20 마감')는 마감 표시로 보지 않는다")
    void deadlineNoticeInTitleIsNotAClosedMarker() {
        assertThat(AuditionRules.isOpen(posting("연극 <자취> 배우 모집 10/20 마감", null, TODAY.plusDays(5), null, TODAY),
                TODAY)).isTrue();
    }

    @Test
    @DisplayName("마감일이 없으면 게시일이 45일 안일 때만 열려 있다")
    void withoutEndDateOpenForFortyFiveDays() {
        assertThat(AuditionRules.isOpen(posting("배우 모집", null, null, null, TODAY.minusDays(45)), TODAY)).isTrue();
        assertThat(AuditionRules.isOpen(posting("배우 모집", null, null, null, TODAY.minusDays(46)), TODAY)).isFalse();
    }

    @Test
    @DisplayName("제목이나 출연료 문구에 휴대폰 번호·이메일 모양이 있으면 걸린다")
    void personalContactsAreDetected() {
        assertThat(AuditionRules.containsPersonalContact(posting("문의 010-1234-5678", null, null, null, TODAY)))
                .isTrue();
        assertThat(AuditionRules.containsPersonalContact(posting("배우 모집", "회당 5만원 문의 01012345678", null, null,
                TODAY))).isTrue();
        assertThat(AuditionRules.containsPersonalContact(posting("배우 모집 casting.kim@example.com", null, null, null,
                TODAY))).isTrue();
        assertThat(AuditionRules.containsPersonalContact(posting("배우 모집", "협의", null, "016.123.4567", TODAY)))
                .isTrue();
    }

    @Test
    @DisplayName("기사 주소 속 긴 숫자열, '@@@@' 장식, 금액은 걸리지 않는다")
    void longDigitRunsAreNotPhoneNumbers() {
        AuditionPosting article = new AuditionPosting("otr", "1", "@@@@ 상상발전소 배우모집", "theater",
                "240~300만원", null, null, null, TODAY,
                "https://news.example.com/article/20261008010012345678?id=0101234567890");
        assertThat(AuditionRules.containsPersonalContact(article)).isFalse();
    }

    @Test
    @DisplayName("정렬은 마감일 오름차순(없는 것은 뒤), 그다음 게시일 내림차순이다")
    void orderByEndThenNewest() {
        AuditionPosting soon = posting("a", null, TODAY.plusDays(1), null, TODAY.minusDays(9));
        AuditionPosting later = posting("b", null, TODAY.plusDays(9), null, TODAY);
        AuditionPosting openOld = posting("c", null, null, null, TODAY.minusDays(9));
        AuditionPosting openNew = posting("d", null, null, null, TODAY);
        assertThat(List.of(openOld, later, openNew, soon).stream().sorted(AuditionRules.ORDER).map(AuditionPosting::title))
                .containsExactly("a", "b", "d", "c");
    }

    @Test
    @DisplayName("켜는 출처 목록은 아는 코드만 순서대로 한 번씩 고르고, 기본값에 플필이 없다")
    void enabledSources() {
        assertThat(AuditionRules.enabledSources(AuditionRules.DEFAULT_SOURCES))
                .containsExactly("shinsee", "emk", "sejong", "otr");
        assertThat(AuditionRules.enabledSources(" otr , plfil,otr,unknown,")).containsExactly("otr", "plfil");
        assertThat(AuditionRules.enabledSources("")).isEmpty();
    }

    @Test
    @DisplayName("공개 id 는 '<출처>-<원문 번호>' 이고 출처 이름이 있다")
    void idAndSourceName() {
        AuditionPosting p = posting("a", null, null, null, TODAY);
        assertThat(p.id()).isEqualTo("otr-1");
        assertThat(AuditionRules.sourceName("shinsee")).isEqualTo("신시컴퍼니");
        assertThat(AuditionRules.SOURCES).containsOnlyKeys("shinsee", "emk", "sejong", "plfil", "otr");
    }
}
