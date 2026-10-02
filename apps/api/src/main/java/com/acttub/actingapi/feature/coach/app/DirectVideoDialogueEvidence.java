package com.acttub.actingapi.feature.coach.app;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** 원본의 오디오 부재는 모델 판단으로 뒤집지 않는다. 잘못된 대사는 저장 전에 거절한다. */
final class DirectVideoDialogueEvidence {
    private static final Pattern QUOTED = Pattern.compile("\"[^\"]*\"|“[^”]*”|「[^」]*」|『[^』]*』");
    private static final Pattern QUOTE_MARK = Pattern.compile("[\"“”「」『』]");
    private static final Set<String> HIDDEN_VALUES = Set.of("없음", "연기", "연기아님", "확인안됨", "화면만");
    private DirectVideoDialogueEvidence() {}

    /** 예전 코치가 지어낸 대사는 새 노트·히스토리의 근거로 다시 쓰지 않는다. 원본 메시지는 보존한다. */
    static void discardUngroundedDesign(DirectVideoModel.Video video, ObjectNode state, String actorWrittenText) {
        if (video == null || !Boolean.FALSE.equals(video.hasAudioTrack())) return;
        if (!(state.path("practice_loop") instanceof ObjectNode loop)) return;
        String design = loop.path("design").asText("");
        if (design.isBlank()) return;
        try {
            requireGrounded(video, "<설계>\n" + design + "\n</설계>", actorWrittenText);
        } catch (IllegalStateException unsupportedAudio) {
            loop.remove("design");
        }
    }

    static void requireGrounded(DirectVideoModel.Video video, String reply, String actorWrittenText) {
        if (video == null || !Boolean.FALSE.equals(video.hasAudioTrack())) return;
        var parsed = DirectVideoPracticeLoop.parse(reply);
        for (String hidden : new String[] {parsed.design(), parsed.status()}) {
            String source = normalized(field(hidden, "관찰 근거"));
            if (source.startsWith("음성만") || source.startsWith("화면·음성")) {
                throw new IllegalStateException("no-audio video reply claims audible observation source");
            }
            String speech = normalized(field(hidden, "대사 확인"));
            if (speech.contains("확인됨") || "confirmed".equals(speech)) {
                throw new IllegalStateException("no-audio video reply claims confirmed speech");
            }
            String dialogue = normalized(field(hidden, "확인된 대사"));
            if (!dialogue.isEmpty() && !"없음".equals(dialogue) && !"none".equals(dialogue)) {
                throw new IllegalStateException("no-audio video reply contains confirmed dialogue");
            }
        }
        // 숨김 칸의 대사도 노트 제목·다음 테이크로 흘러갈 수 있으므로 본문만 검사하지 않는다.
        requireGroundedQuotes(parsed.message(), actorWrittenText, false);
        requireGroundedQuotes(parsed.design(), actorWrittenText, true);
        requireGroundedQuotes(parsed.status(), actorWrittenText, true);
    }

    private static void requireGroundedQuotes(String text, String actorWrittenText, boolean hidden) {
        var quoted = QUOTED.matcher(text);
        while (quoted.find()) {
            String literal = quoted.group();
            String value = normalized(literal.substring(1, literal.length() - 1));
            if (hidden && HIDDEN_VALUES.contains(value)) continue;
            if (actorWrittenText != null && actorWrittenText.contains(literal)) continue;
            throw new IllegalStateException("no-audio video reply contains ungrounded quotation");
        }
        if (QUOTE_MARK.matcher(QUOTED.matcher(text).replaceAll("")).find()) {
            throw new IllegalStateException("no-audio video reply contains incomplete quotation");
        }
    }

    private static String field(String hidden, String name) {
        for (String line : hidden.split("\\R")) {
            String stripped = line.strip();
            if (stripped.startsWith(name + ":")) return stripped.substring(name.length() + 1).strip();
        }
        return "";
    }

    private static String normalized(String value) {
        return value.replaceAll("[\\[\\]\\s\"“”「」『』]", "").toLowerCase(Locale.ROOT);
    }
}
