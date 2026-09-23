package com.acttub.actingapi.feature.reading.domain;

import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

/**
 * 대본의 규칙 — 한도와 배역 이름의 모양 (reading.script · reading.cast). 프레임워크를 모른다.
 *
 * <p>숫자는 성능 측정 없이 정한 초기 한도다. 길이는 유니코드 코드 포인트로 센다(줄바꿈 포함).
 */
public final class ScriptRules {

    /** 원문 한 편의 상한. 줄 본문의 총량도 같은 값으로 본다. */
    public static final int TEXT_MAX = 100_000;

    /** 줄 수의 상한 — 대사·지문·장면 모두. */
    public static final int LINES_MAX = 3_000;

    /** 배역 수의 상한 — 전체 배역. */
    public static final int CHARACTERS_MAX = 50;

    /** 회원이 가질 수 있는 대본 수. 이관으로 넘으면 자료는 보존하고 새 등록만 막는다. */
    public static final int MEMBER_SCRIPT_MAX = 100;

    /** 게스트가 가질 수 있는 대본 수. 예시 대본을 저장한 것도 센다. */
    public static final int GUEST_SCRIPT_MAX = 20;

    /** 상대역 목소리 프리셋 id 의 상한. 서버는 목록을 모르고 길이만 본다. */
    public static final int VOICE_PRESET_MAX = 32;

    private ScriptRules() {
    }

    /** 코드 포인트 수. */
    public static int length(String value) {
        return value.codePointCount(0, value.length());
    }

    public static int scriptLimit(boolean guest) {
        return guest ? GUEST_SCRIPT_MAX : MEMBER_SCRIPT_MAX;
    }

    /** 앞뒤 공백을 정리한 이름. 비어 있으면 {@code null} — 그 이름은 배역이 될 수 없다. */
    public static String normalizedName(String name) {
        if (name == null) {
            return null;
        }
        String stripped = name.strip();
        return stripped.isEmpty() ? null : stripped;
    }

    /** 배역 이름 목록이 규칙에 맞는가 — 비어 있는 이름이 없고 같은 대본 안에서 겹치지 않는다. */
    public static boolean namesAllowed(Collection<String> names) {
        Set<String> seen = new HashSet<>();
        for (String name : names) {
            if (name == null || !name.equals(name.strip()) || name.isEmpty() || !seen.add(name)) {
                return false;
            }
        }
        return true;
    }

    /** {@code null} 은 "자동"이라 언제나 된다. */
    public static boolean voicePresetAllowed(String preset) {
        return preset == null || length(preset) <= VOICE_PRESET_MAX;
    }

    /**
     * 저장 요청이 규칙에 걸리는가. 배역이 없으면 {@link Rejection#NO_CHARACTERS}, 이름이 비거나 겹치면
     * {@link Rejection#INVALID_CHARACTERS}, 원문·줄 본문 총량·줄 수·배역 수가 한도를 넘으면
     * {@link Rejection#TOO_LONG}. 걸리지 않으면 {@code null}.
     */
    public static Rejection check(ScriptDraft draft) {
        if (draft.characterNames().isEmpty()) {
            return Rejection.NO_CHARACTERS;
        }
        if (!namesAllowed(draft.characterNames())) {
            return Rejection.INVALID_CHARACTERS;
        }
        if (draft.characterNames().size() > CHARACTERS_MAX
                || draft.lines().size() > LINES_MAX
                || length(draft.rawText()) > TEXT_MAX) {
            return Rejection.TOO_LONG;
        }
        long total = 0;
        for (ScriptDraft.Line line : draft.lines()) {
            total += length(line.text());
            if (total > TEXT_MAX) {
                return Rejection.TOO_LONG;
            }
        }
        return null;
    }

    public enum Rejection {
        NO_CHARACTERS,
        INVALID_CHARACTERS,
        TOO_LONG
    }
}
