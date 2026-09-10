package com.acttub.actingapi.feature.coach.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.coach.domain.ClosingIntent;
import com.acttub.actingapi.feature.coach.domain.CoachBranch;
import com.acttub.actingapi.feature.coach.domain.CoachHelpIntent;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.TextValidator;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** 추가 모델 호출 없이 막힘 복구·반복 방지·종료를 지키는 서버 측 경계. */
final class CoachResponsePolicy {
    private static final Pattern MARKDOWN_PRESENTATION = Pattern.compile(
            "(?m)^\\s{0,3}#{1,6}\\s|\\*\\*[^\\n]+?\\*\\*|__[^\\n]+?__|```");
    private static final Pattern INTERNAL_FORMAT_NOTE = Pattern.compile(
            "(?i)\\bJSON\\s+(?:need(?:ed)?|only|required)\\b");

    private CoachResponsePolicy() {
    }

    static String recoveryInstruction(CoachSessionSnapshot session, String actorText) {
        if (!CoachHelpIntent.needsExplanation(actorText)) {
            return "";
        }
        long earlierUnsure = session.turns().stream()
                .filter(turn -> "actor".equals(turn.role()))
                .skip(1) // 첫 발화는 폼의 막힘 상세다.
                .filter(turn -> CoachHelpIntent.needsExplanation(turn.text())).count();
        return "\n\n## 이번 응답의 막힘 복구\n"
                + (earlierUnsure == 0
                ? "질문을 쉬운 말로 설명하고 기존 대사·관찰에 연결한 예시 하나를 먼저 준다."
                : "배우가 이 대화에서 여러 번 모르겠다고 했다. 선택지나 실행·자기정리 요청을 반복하지 않는다. "
                        + "잠정 설명 또는 방법 하나와 근거를 먼저 주고 미확인 부분을 남긴다. "
                        + "제공된 상황·목표 안에서 가장 적게 추정하는 설명을 쓰고, 새 관계 갈등이나 심리적 원인을 덧붙이지 않는다.");
    }

    static List<String> failures(CoachSessionSnapshot session, String actorText, CoachReply reply) {
        List<String> failures = new ArrayList<>(TextValidator.validateCoachTurn(reply.message()).failures());
        if (reply.message().isBlank()) {
            failures.add("배우에게 보여줄 응답이 비어 있다. 현재 요청에 답한다.");
        }
        if (MARKDOWN_PRESENTATION.matcher(reply.message()).find()) {
            failures.add("대화 화면은 일반 텍스트다. Markdown 강조·제목·코드 기호를 제거해 다시 답한다.");
        }
        if (INTERNAL_FORMAT_NOTE.matcher(reply.message()).find()) {
            failures.add("JSON 출력 형식에 대한 내부 작업 메모가 응답에 섞였다. 메모를 제거하고 배우의 요청에만 답한다.");
        }
        String explanation = reply.message();
        for (String transcript : session.transcripts()) {
            if (!transcript.isBlank()) explanation = explanation.replace(transcript, "");
        }
        if (usesEnglish(session, actorText) && explanation.matches("(?s).*[가-힣].*")
                && !explanation.matches("(?s).*[A-Za-z].*")) {
            failures.add("배우는 영어로 대화하고 있다. 대사 인용을 제외한 설명은 영어로 답한다.");
        }
        if (mustClose(session, actorText) && !"complete".equals(reply.status())) {
            failures.add("종료 요청 또는 마지막 응답이다. 새 질문 없이 complete와 handoff를 작성한다.");
        }
        if (CoachHelpIntent.isHelpOnly(actorText)) {
            String previous = session.turns().stream().filter(turn -> "ai".equals(turn.role()))
                    .reduce((first, second) -> second).map(CoachTurnSnapshot::text).orElse("");
            if (!previous.isBlank() && normalize(previous).equals(normalize(reply.message()))) {
                failures.add("도움 요청에 직전 응답을 반복했다. 설명과 구체적인 예시로 바꾼다.");
            }
        }
        return failures;
    }

    static boolean mustClose(CoachSessionSnapshot session, String actorText) {
        return ClosingIntent.isClosing(actorText) || CoachPrompt.turnNumber(session) >= CoachPrompt.TURN_BUDGET;
    }

    static CoachReply fallback(CoachSessionSnapshot session, String actorText) {
        boolean english = usesEnglish(session, actorText);
        if (mustClose(session, actorText)) {
            // 실패한 모델 응답에서 결론·실행·효과를 추출하지 않는다. 저장 후 노트 재생성도 막는다.
            ObjectNode handoff = JsonNodeFactory.instance.objectNode();
            handoff.put("handoff_type", CoachBranch.of(session.blockageKind()));
            handoff.put("completion_level", "unavailable");
            handoff.putArray("actor_words");
            handoff.putArray("uncertainties").add(english
                    ? "A reliable summary could not be generated. Practice and effects remain unverified."
                    : "정확한 정리를 만들지 못함. 연습 실행과 효과는 미확인.");
            return new CoachReply(english
                    ? "We’ll stop here. I couldn’t reliably summarize this conversation, so I haven’t recorded a conclusion or a practice result."
                    : "대화는 여기서 마칠게요. 정확한 정리를 만들지 못해 결론이나 연습 효과를 기록하지 않았어요.",
                    "complete", handoff);
        }
        if (CoachHelpIntent.needsExplanation(actorText)) {
            if (CoachBranch.isExpressionBlockage(session.blockageKind())) {
                return new CoachReply(english
                        ? "I couldn’t tailor the explanation reliably. As an example of changing one element, you could keep a line’s volume the same and vary only the length of its last word. This is an example for later, not a result observed in your video."
                        : "지금 문제에 맞는 설명을 정확하게 만들지 못했어요. 요소 하나만 바꾼다는 건, 예를 들어 음량은 두고 마지막 단어의 길이만 달리하는 방식이에요. 다음에 참고할 예시이며 영상에서 확인된 효과는 아니에요.",
                        "continue", null);
            }
            return new CoachReply(english
                    ? "My explanation wasn’t clear enough. For example, wanting someone to stay and whether they actually stay are separate things; you don’t need to decide both at once. I haven’t established which interpretation fits your scene."
                    : "제가 설명을 충분히 풀지 못했어요. 예를 들어 상대가 남아주길 바라는 것과 실제로 남을 수 있는지는 별개라서 한꺼번에 답하지 않아도 돼요. 지금 장면에 어떤 해석이 맞는지는 아직 확인하지 못했어요.",
                    "continue", null);
        }
        return new CoachReply(english
                ? "I couldn’t produce a reliable answer to that request. Your question and corrections are still in this conversation; you can rephrase the part you want explained or stop here."
                : "이번 요청에 맞는 답을 정확하게 만들지 못했어요. 질문과 정정한 내용은 대화에 남아 있어요. 설명이 필요한 부분을 다시 적거나 여기서 마쳐도 괜찮아요.",
                "continue", null);
    }

    private static boolean usesEnglish(CoachSessionSnapshot session, String actorText) {
        List<String> candidates = new ArrayList<>();
        candidates.add(actorText);
        for (int index = session.turns().size() - 1; index >= 0; index--) {
            CoachTurnSnapshot turn = session.turns().get(index);
            if ("actor".equals(turn.role())) candidates.add(turn.text());
        }
        for (String candidate : candidates) {
            if (ClosingIntent.isClosing(candidate) || CoachHelpIntent.isHelpOnly(candidate)) continue;
            String lowered = candidate.toLowerCase(Locale.ROOT);
            if (lowered.contains("in korean") || lowered.contains("한국어로")) return false;
            if (lowered.contains("in english") || lowered.contains("영어로")) return true;
            if (candidate.matches("(?s).*[가-힣].*")) return false;
            if (candidate.matches("(?s).*[A-Za-z].*")) return true;
        }
        return actorText.matches("(?s).*[A-Za-z].*");
    }

    private static String normalize(String text) {
        return text.toLowerCase(Locale.ROOT).replaceAll("[\\p{P}\\p{Z}\\s]", "");
    }
}
