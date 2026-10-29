package com.acttub.actingapi.feature.push.app;

import java.util.List;

/**
 * 연습 알림의 문구 전부. 문구를 고칠 때는 이 파일만 연다.
 *
 * <p>규칙
 * <ul>
 *   <li>해요체, 부담 주지 않는 말투. 죄책감을 건드리거나 이벤트·홍보를 섞지 않는다.</li>
 *   <li>잠금 화면에 그대로 보이므로 작품 제목·대본 대사·인물 이름을 넣지 않는다.</li>
 *   <li>id 는 보낸 기록(practice_reminder_sends.template_id)에 남아 14일 돌려쓰기 판정에 쓰인다.
 *       <b>한 번 쓴 id 의 뜻은 바꾸지 않는다</b> — 문구를 크게 바꾸면 새 id 를 쓴다.</li>
 *   <li>자리표시자: {@code {take}} 는 다듬은 다음 촬영 지시, {@code {n}} 은 연속 일수, {@code {q}} 는 코치 질문의 앞부분이다.</li>
 *   <li>영어는 한국어 외 언어 설정을 위한 최소 한 벌이다.</li>
 * </ul>
 */
public final class ReminderTemplates {
    private ReminderTemplates() {}

    /** 문구 하나. 숙제 문구는 제목만 돌리고 본문은 {@code {take}} 하나다. */
    public record Template(String id, String title, String body) {}

    public static final String TAKE = "{take}";
    public static final String COUNT = "{n}";
    public static final String QUESTION = "{q}";

    /** 노트에 적힌 지시를 쓸 수 없을 때(한글이 아니거나 너무 짧음) 숙제 본문 대신 쓰는 말. */
    public static final String HOMEWORK_FALLBACK_KO = "노트에 남긴 한 가지만 해 봐도 충분해요.";
    public static final String HOMEWORK_FALLBACK_EN = "Trying just the one thing from your note is enough.";

    // ── 바로 이어 하기(resume): 하루 지난 열린 코칭. 문구는 둘뿐이라 돌리지 않는다.
    public static final String RESUME_TITLE_KO = "아까 하던 코칭 마저 할까요?";
    public static final Template RESUME_UNANSWERED_KO =
            new Template("resume.unanswered.ko", RESUME_TITLE_KO, "코치 질문이 남아 있어요: " + QUESTION);
    public static final Template RESUME_ANSWERED_KO =
            new Template("resume.answered.ko", RESUME_TITLE_KO, "답한 건 저장돼 있어요. 코치가 물어본 것: " + QUESTION);
    /** 질문 글을 쓸 수 없을 때(한글이 아니거나 너무 짧음)의 본문. */
    public static final Template RESUME_UNANSWERED_PLAIN_KO =
            new Template("resume.unanswered_plain.ko", RESUME_TITLE_KO, "코치 질문이 남아 있어요. 이어서 답해 볼까요?");
    public static final Template RESUME_ANSWERED_PLAIN_KO =
            new Template("resume.answered_plain.ko", RESUME_TITLE_KO, "답한 건 저장돼 있어요. 이어서 해 볼까요?");

    public static final Template RESUME_UNANSWERED_EN =
            new Template("resume.unanswered.en", "Finish that coaching?", "A coach question is still open: " + QUESTION);
    public static final Template RESUME_ANSWERED_EN =
            new Template("resume.answered.en", "Finish that coaching?", "Your answer is saved. The coach asked: " + QUESTION);
    public static final Template RESUME_UNANSWERED_PLAIN_EN =
            new Template("resume.unanswered_plain.en", "Finish that coaching?", "A coach question is still open. Want to answer?");
    public static final Template RESUME_ANSWERED_PLAIN_EN =
            new Template("resume.answered_plain.en", "Finish that coaching?", "Your answer is saved. Want to continue?");

    // ── 일반(general): 걸러 넘긴 날 수 구간별. k=1 / k=2~3 / k=4~7
    public static final List<Template> GENERAL_1_KO = List.of(
            new Template("general.1.a", "오늘 연습 아직이에요", "5분이면 돼요. 장면 하나 찍거나 대본 한 번 읽어 볼까요?"),
            new Template("general.1.b", "오늘은 가볍게 한 번만", "대사 한 줄만 말해 봐도 연습이에요."),
            new Template("general.1.c", "어제 하던 거 이어서 해 볼까요?", "짧게 한 장면만 찍어 봐도 좋아요."),
            new Template("general.1.d", "잠깐 연습할 시간 있어요?", "5분이면 충분해요. 편한 장면부터 시작해요."),
            new Template("general.1.e", "오늘 연습이 아직 비어 있어요", "대본 한 번 읽는 것부터 해 봐요."),
            new Template("general.1.f", "하루에 한 장면", "오늘 하나만 찍어 보면 어때요?"),
            new Template("general.1.g", "컨디션 괜찮을 때 한 번", "길게 안 해도 돼요. 한 장면이면 충분해요."));

    public static final List<Template> GENERAL_2_3_KO = List.of(
            new Template("general.2.a", "이번 주에 한 장면 어때요?", "5분만 내면 돼요. 부담 없이 시작해요."),
            new Template("general.2.b", "다시 몸 풀어 볼까요?", "대사 한 줄만 소리 내서 읽어 봐도 좋아요."),
            new Template("general.2.c", "가볍게 다시 시작해요", "새로 찍지 않아도 돼요. 대본 한 번 읽어 봐요."),
            new Template("general.2.d", "한 장면 찍어 볼까요?", "짧게 한 번이면 충분해요."),
            new Template("general.2.e", "연기 감각 깨워 볼까요?", "5분만 내서 대사 한 번 읽어 봐요."),
            new Template("general.2.f", "시간 날 때 한 번", "한 장면만 해도 좋아요. 편할 때 열어 보세요."));

    public static final List<Template> GENERAL_4_7_KO = List.of(
            new Template("general.4.a", "다시 시작하기 좋은 날이에요", "한 장면, 5분이면 돼요."),
            new Template("general.4.b", "오랜만이에요, 가볍게 한 번", "새로 시작하지 않아도 돼요. 하던 장면부터 해요."),
            new Template("general.4.c", "한 줄만 읽어도 다시 시작이에요", "부담 없이 대본을 열어 봐요."),
            new Template("general.4.d", "오늘 5분만 내 볼까요?", "대사 한 번 읽는 것부터 해요."),
            new Template("general.4.e", "이번 주에 한 장면만", "가볍게 시작해 보세요."),
            new Template("general.4.f", "다시 해 보고 싶을 때가 시작이에요", "짧게 한 장면이면 충분해요."));

    // ── 숙제(homework): 제목만 돌린다. 본문은 노트의 다음 촬영 지시({take}).
    public static final List<Template> HOMEWORK_1_KO = List.of(
            new Template("homework.1.a", "지난번에 정한 거, 오늘 해 볼까요?", TAKE),
            new Template("homework.1.b", "어제 정한 한 가지, 이어서 해 봐요", TAKE),
            new Template("homework.1.c", "다음엔 이걸 해 보기로 했어요", TAKE),
            new Template("homework.1.d", "오늘은 이것 하나만 해 봐요", TAKE),
            new Template("homework.1.e", "노트에 남긴 한 가지예요", TAKE));

    public static final List<Template> HOMEWORK_2_3_KO = List.of(
            new Template("homework.2.a", "노트에 남긴 한 가지, 해 볼까요?", TAKE),
            new Template("homework.2.b", "지난번에 정한 거 기억나요?", TAKE),
            new Template("homework.2.c", "다음 촬영에서 해 보기로 한 거예요", TAKE),
            new Template("homework.2.d", "이 한 가지만 해 봐도 충분해요", TAKE),
            new Template("homework.2.e", "가볍게 이것부터 해 봐요", TAKE));

    public static final List<Template> HOMEWORK_4_7_KO = List.of(
            new Template("homework.4.a", "지난번 노트, 다시 열어 볼까요?", TAKE),
            new Template("homework.4.b", "정해 둔 한 가지가 남아 있어요", TAKE),
            new Template("homework.4.c", "오늘 이것 하나만 해 봐요", TAKE),
            new Template("homework.4.d", "다시 시작하기 좋은 한 가지예요", TAKE),
            new Template("homework.4.e", "이 한 가지로 다시 시작해요", TAKE));

    // ── 리딩(reading): 마지막 연습이 대본 리딩이었을 때. 작품 제목은 넣지 않는다.
    public static final List<Template> READING_KO = List.of(
            new Template("reading.a", "대본 이어서 읽어 볼까요?", "한 장면만 소리 내어 읽어 봐도 좋아요."),
            new Template("reading.b", "오늘 리딩 한 번 어때요?", "처음부터 안 해도 돼요. 읽던 곳부터 이어요."),
            new Template("reading.c", "소리 내어 읽어 봐요", "5분이면 한 장면 읽을 수 있어요."),
            new Template("reading.d", "리딩할 시간이에요", "편한 대사부터 가볍게 시작해요."),
            new Template("reading.e", "상대역 대사가 기다려요", "내 대사 몇 줄만 읽어 봐도 돼요."),
            new Template("reading.f", "한 번 더 읽어 볼까요?", "지난번보다 한 줄만 더 읽어 봐요."),
            new Template("reading.g", "대사 연습 이어서 해요", "읽던 곳에서 이어서 하면 돼요."));

    // ── 올려 둔 영상(pending_video): 직접 올렸지만 그 영상으로 코칭을 시작하지 않았을 때. 영상 제목·내용은 넣지 않는다.
    public static final List<Template> VIDEO_KO = List.of(
            new Template("video.a", "올려 둔 영상이 그대로 있어요", "코치에게 보여 주면 첫 질문부터 시작해요."),
            new Template("video.b", "찍어 둔 연기, 코치가 아직 못 봤어요", "이미 찍었으니 대화만 시작하면 돼요."),
            new Template("video.c", "영상은 이미 올라와 있어요", "코치가 어떤 질문을 할지 들어 보세요."));

    // ── 넣어 둔 대본(unread_script): 직접 넣었지만 그 대본으로 리딩을 시작하지 않았을 때. 작품명·대사는 넣지 않는다.
    public static final List<Template> SCRIPT_KO = List.of(
            new Template("script.a", "넣어 둔 대본, 상대역이 기다려요", "상대 대사는 AI가 읽어 줘요. 내 대사만 읽으면 돼요."),
            new Template("script.b", "대본은 준비돼 있어요", "배역만 고르면 바로 맞춰 읽을 수 있어요."),
            new Template("script.c", "넣어 둔 대본으로 바로 리딩할 수 있어요", "처음부터 다 안 읽어도 돼요. 한 장면만 맞춰 봐요."));

    // ── 첫 연습(first_practice): 아직 한 번도 연습하지 않은 가입자(가입 시각 기준).
    // SOMA-870: 막연한 권유(first.a~f, 24시간 안 복귀 1%)를 할 거리가 보이는 문구로 바꿨다. 새 id 라 전후를 기록으로 가를 수 있다.
    public static final List<Template> FIRST_PRACTICE_KO = List.of(
            new Template("first.g", "예시 대본, 30초면 읽어요", "상대 대사는 AI가 읽어 줘요. 내 줄만 소리 내 보세요."),
            new Template("first.h", "대사 한 줄부터 시작해요", "앱에 있는 예시 대본을 열고 내 줄만 읽어 보세요."),
            new Template("first.i", "상대역은 AI가 맡을게요", "예시 대본으로 내 대사만 읽으면 첫 연습 끝이에요."),
            new Template("first.j", "첫 리딩, 30초면 끝나요", "예시 대본을 고르고 내 줄을 소리 내 읽어 보세요."),
            new Template("first.k", "혼자 읽어도 상대가 있어요", "AI가 상대 대사를 읽어 줘요. 예시 대본으로 해 봐요."));

    // ── 가입 30분(first_nudge, SOMA-870): 가입한 날 30분~2시간 안에 아직 첫 연습 전인 회원
    public static final List<Template> FIRST_NUDGE_KO = List.of(
            new Template("nudge.a", "첫 대사, 지금 30초면 돼요", "예시 대본을 열고 내 줄만 읽어 보세요. 상대는 AI예요."),
            new Template("nudge.b", "가입 고마워요! 한 줄만 읽어 볼까요?", "예시 대본으로 첫 리딩을 해 보세요. 30초면 끝나요."),
            new Template("nudge.c", "상대역은 AI가 준비해 뒀어요", "예시 대본에서 내 대사만 소리 내 읽으면 돼요."),
            new Template("nudge.d", "첫 연습은 대사 한 줄이면 돼요", "예시 대본을 고르면 AI가 상대 대사를 읽어 줘요."),
            new Template("nudge.e", "30초짜리 첫 리딩 해 볼까요?", "잘 읽지 않아도 돼요. 내 줄만 소리 내 보세요."));

    // ── 연속 기록(streak): {n} 은 연속 일수
    public static final List<Template> STREAK_KO = List.of(
            new Template("streak.a", COUNT + "일 연속 연습 중이에요", "오늘 한 번만 하면 이어져요."),
            new Template("streak.b", COUNT + "일째 이어 온 연습이에요", "5분이면 오늘도 이어 갈 수 있어요."),
            new Template("streak.c", "오늘 기록이 아직 비어 있어요", COUNT + "일 연속, 한 장면이면 이어져요."),
            new Template("streak.d", COUNT + "일 연속 기록이 오늘 끊길 수 있어요", "자기 전에 가볍게 한 번 해 봐요."),
            new Template("streak.e", COUNT + "일 연속, 오늘만 더 해 볼까요?", "대사 한 줄도 괜찮아요."),
            new Template("streak.f", "연습 " + COUNT + "일째 기록을 이어 가요", "짧게 한 번이면 충분해요."));

    // ── 영어 최소 한 벌
    public static final List<Template> GENERAL_EN = List.of(
            new Template("general.en.a", "No practice yet today", "Five minutes is enough. Shoot one scene or run a script?"),
            new Template("general.en.b", "A quick one today?", "Even one line out loud counts as practice."));
    public static final List<Template> HOMEWORK_EN = List.of(
            new Template("homework.en.a", "Ready to try what you planned?", TAKE),
            new Template("homework.en.b", "One thing from your note", TAKE));
    public static final List<Template> READING_EN = List.of(
            new Template("reading.en.a", "Pick up your reading?", "Reading one scene out loud is enough."),
            new Template("reading.en.b", "Time for a read-through?", "Start with the lines that feel easy."));
    public static final List<Template> FIRST_PRACTICE_EN = List.of(
            new Template("first.en.a", "Your first practice takes five minutes", "Shoot one scene or read a script once."),
            new Template("first.en.b", "Start small today", "Reading a single line aloud is a fine start."));
    public static final List<Template> FIRST_NUDGE_EN = List.of(
            new Template("nudge.en.a", "Your first line takes 30 seconds", "Open a sample script and read only your lines. The AI reads the rest."));
    public static final List<Template> VIDEO_EN = List.of(
            new Template("video.en.a", "Your video is still waiting", "Show it to the coach and start with the first question."));
    public static final List<Template> SCRIPT_EN = List.of(
            new Template("script.en.a", "Your script is ready", "The AI reads the other parts. You only read yours."));
    public static final List<Template> STREAK_EN = List.of(
            new Template("streak.en.a", COUNT + "-day streak going", "One quick practice keeps it alive today."),
            new Template("streak.en.b", "Keep your " + COUNT + "-day streak", "A single line counts."));

    /** 종류·건너뛴 날 수·언어에 맞는 돌려쓰기 후보 목록. 바로 이어 하기는 따로 고르므로 여기에 없다. */
    public static List<Template> pool(ReminderKind kind, int skippedDays, boolean korean) {
        return switch (kind) {
            case GENERAL -> korean ? (skippedDays <= 1 ? GENERAL_1_KO : skippedDays <= 3 ? GENERAL_2_3_KO : GENERAL_4_7_KO)
                    : GENERAL_EN;
            case HOMEWORK -> korean ? (skippedDays <= 1 ? HOMEWORK_1_KO : skippedDays <= 3 ? HOMEWORK_2_3_KO : HOMEWORK_4_7_KO)
                    : HOMEWORK_EN;
            case READING -> korean ? READING_KO : READING_EN;
            case FIRST_PRACTICE -> korean ? FIRST_PRACTICE_KO : FIRST_PRACTICE_EN;
            case FIRST_NUDGE -> korean ? FIRST_NUDGE_KO : FIRST_NUDGE_EN;
            case PENDING_VIDEO -> korean ? VIDEO_KO : VIDEO_EN;
            case UNREAD_SCRIPT -> korean ? SCRIPT_KO : SCRIPT_EN;
            case STREAK -> korean ? STREAK_KO : STREAK_EN;
            case RESUME -> throw new IllegalArgumentException("resume 는 돌려쓰지 않는다");
        };
    }
}
