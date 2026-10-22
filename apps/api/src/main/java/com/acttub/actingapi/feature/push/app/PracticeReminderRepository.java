package com.acttub.actingapi.feature.push.app;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** 개인화 연습 알림이 읽고 쓰는 저장소 포트. 구현은 {@code adapter/db} 의 네이티브 SQL이다. */
public interface PracticeReminderRepository {

    /**
     * 보낼 수 있는 회원 한 명의 요약. 활성 회원이고 토글이 켜져 있으며 앱 판이 기준 이상인 토큰이 있다.
     *
     * @param firstPracticeAt  D 의 첫 연습 시각. 연습한 적이 없으면 가입 시각
     * @param lastPracticeDay  D(한국 날짜). 연습한 적이 없으면 가입일
     * @param neverPracticed   연습한 적이 한 번도 없다
     * @param lastWasReading   가장 최근 연습 사건이 리딩이다
     * @param practicedToday   오늘(한국) 연습 사건이 있다
     * @param sentToday        오늘 이미 보낸 칸('practice'·'streak')
     */
    record Candidate(UUID userId, List<PushTarget> targets, Instant firstPracticeAt, LocalDate lastPracticeDay,
                     boolean neverPracticed, boolean lastWasReading, boolean practicedToday, Set<String> sentToday) {}

    /** 연속 기록 알림 후보: 오늘 연습 전이고 어제까지 연습한 회원. */
    List<Candidate> candidates(LocalDate today, Instant windowStart, String minimumAppVersion);

    /** 앱의 연속 일수와 같은 기준으로 센 연습한 날(한국 날짜). 오늘 포함. */
    Set<LocalDate> countedPracticeDays(UUID userId, LocalDate since);

    /** 가장 최근 코칭 대화가 열려 있고 마지막 메시지가 코치 질문이면 그 대화. 없으면 null. */
    ReminderContent.Resume latestOpenQuestion(UUID userId);

    /** 가장 최근 노트가 action 이고 다음 촬영 지시가 있으면 그 노트. 없으면 null. */
    ReminderContent.Homework latestHomework(UUID userId);

    /**
     * 직접 올린 영상 가운데 {@code since} 이후에 만들었고 파기되지 않았으며 코칭 회차·챌린지 참여작에 쓰이지 않은 것 중
     * 가장 최근 것의 id. 없으면 null.
     */
    UUID latestPendingVideo(UUID userId, Instant since);

    /**
     * 직접 넣은 대본 가운데 {@code since} 이후에 만들었고 리딩 회차가 없는, 앱 예시(source=sample)가 아닌 것 중
     * 가장 최근 것의 id. 없으면 null.
     */
    UUID latestUnreadScript(UUID userId, Instant since);

    /** {@code since}(한국 날짜, 포함) 이후에 보낸 종류별 횟수. 키는 {@link ReminderKind#wire()}. */
    Map<String, Integer> sentCountsByKind(UUID userId, LocalDate since);

    /** 최근 보낸 문구 id → 마지막으로 보낸 한국 날짜. */
    Map<String, LocalDate> recentTemplates(UUID userId, LocalDate since);

    /** 보낼 자리를 선점한다. 이미 있으면 false. 선점한 쪽만 보낸다. */
    boolean claim(UUID userId, LocalDate day, ReminderCopy copy);
}
