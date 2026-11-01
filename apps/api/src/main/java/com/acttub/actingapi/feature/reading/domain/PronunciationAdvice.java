package com.acttub.actingapi.feature.reading.domain;

import java.util.Map;

/**
 * 발음 보고서의 칠한 어절 하나에 붙는 상세 분석(SOMA-606, 11/1 시안) — 어떻게 들렸나 · 어디가 · 두 소리 차이 · 해 볼 연습.
 *
 * <p>두 소리 차이는 소리 내는 자리(입술·혀끝·혀 뒤 …)와 방법(콧소리·예사·거센·된소리 …), 모음은 입 모양 표에서 실제로 다른
 * 것만 이어 쓴다. 채점이 짚은 소리 하나에 대한 설명이라 단정하지 않는다("~에 가까웠어요"). 판정 정확도는 검증되지 않았다.
 */
public final class PronunciationAdvice {

    /**
     * @param heard    들린 대로 읽은 말 한 구절. 예: '안명'처럼 들렸어요
     * @param where    어느 글자의 어느 소리인지. 예: '녕'의 첫소리 ㄴ이 ㅁ에 가까웠어요
     * @param kind     자음이 바뀜 · 받침이 바뀜 · 모음이 바뀜
     * @param diff     두 소리 차이
     * @param practice 해 볼 연습 하나
     */
    public record Detail(String heard, String where, String kind, String diff, String practice) {
        /** 1.1.0 앱의 「다른 말로 알아들을 수 있는 곳」 한 줄에 그대로 넣는 글. */
        public String sentence() {
            return heard + ". " + where + "(" + kind + "). " + diff + " " + practice;
        }
    }

    enum Slot { ONSET, VOWEL, CODA }

    private enum Place {
        LIPS("두 입술을 닫아요", "두 입술을 닫고", "두 입술을 붙였다 떼며"),
        TIP("혀끝을 윗잇몸에 대요", "혀끝을 윗잇몸에 대고", "혀끝을 윗잇몸에 대고"),
        HISS("혀끝을 윗잇몸 가까이 두고 바람을 흘려요", "혀끝을 윗잇몸 가까이 두고 바람을 흘리고", "혀끝을 윗잇몸 가까이 두고 바람을 흘리며"),
        BLADE("혓바닥 앞쪽을 입천장 앞쪽에 붙여요", "혓바닥 앞쪽을 입천장 앞쪽에 붙이고", "혓바닥 앞쪽을 입천장에 붙였다 떼며"),
        BACK("혀 뒤를 입천장 안쪽에 붙여요", "혀 뒤를 입천장 안쪽에 붙이고", "혀 뒤를 입천장 안쪽에 붙였다 떼며"),
        THROAT("목에서 바람만 내요", "목에서 바람만 내고", "목에서 바람을 내며");

        final String does;
        final String doesAnd;
        final String doing;

        Place(String does, String doesAnd, String doing) {
            this.does = does;
            this.doesAnd = doesAnd;
            this.doing = doing;
        }
    }

    private enum Manner { NASAL, LIQUID, LAX, ASPIRATED, TENSE }

    private record Consonant(Place place, Manner manner) {
    }

    private static final Map<String, Consonant> CONSONANTS = Map.ofEntries(
            Map.entry("ㄱ", new Consonant(Place.BACK, Manner.LAX)), Map.entry("ㄲ", new Consonant(Place.BACK, Manner.TENSE)),
            Map.entry("ㅋ", new Consonant(Place.BACK, Manner.ASPIRATED)), Map.entry("ㅇ", new Consonant(Place.BACK, Manner.NASAL)),
            Map.entry("ㄷ", new Consonant(Place.TIP, Manner.LAX)), Map.entry("ㄸ", new Consonant(Place.TIP, Manner.TENSE)),
            Map.entry("ㅌ", new Consonant(Place.TIP, Manner.ASPIRATED)), Map.entry("ㄴ", new Consonant(Place.TIP, Manner.NASAL)),
            Map.entry("ㄹ", new Consonant(Place.TIP, Manner.LIQUID)),
            Map.entry("ㅂ", new Consonant(Place.LIPS, Manner.LAX)), Map.entry("ㅃ", new Consonant(Place.LIPS, Manner.TENSE)),
            Map.entry("ㅍ", new Consonant(Place.LIPS, Manner.ASPIRATED)), Map.entry("ㅁ", new Consonant(Place.LIPS, Manner.NASAL)),
            Map.entry("ㅅ", new Consonant(Place.HISS, Manner.LAX)), Map.entry("ㅆ", new Consonant(Place.HISS, Manner.TENSE)),
            Map.entry("ㅈ", new Consonant(Place.BLADE, Manner.LAX)), Map.entry("ㅉ", new Consonant(Place.BLADE, Manner.TENSE)),
            Map.entry("ㅊ", new Consonant(Place.BLADE, Manner.ASPIRATED)),
            Map.entry("ㅎ", new Consonant(Place.THROAT, Manner.ASPIRATED)));

    /** 모음 입 모양. [설명, 이어 쓰는 꼴, 연습 때 붙이는 동작]. */
    private static final Map<String, String[]> VOWELS = Map.ofEntries(
            Map.entry("ㅏ", new String[] {"입을 크게 벌려요", "입을 크게 벌리고", "입을 크게 벌리고"}),
            Map.entry("ㅓ", new String[] {"입술을 편 채 턱을 내려요", "입술을 편 채 턱을 내리고", "입술을 편 채 턱을 내리고"}),
            Map.entry("ㅗ", new String[] {"입술을 둥글게 모아 내밀어요", "입술을 둥글게 모아 내밀고", "입술을 둥글게 모아 내밀고"}),
            Map.entry("ㅜ", new String[] {"입술을 ㅗ보다 더 좁게 모아 내밀어요", "입술을 ㅗ보다 더 좁게 모아 내밀고", "입술을 좁게 모아 내밀고"}),
            Map.entry("ㅡ", new String[] {"입술을 옆으로 펴고 이를 거의 다물어요", "입술을 옆으로 펴고 이를 거의 다물고", "입술을 옆으로 펴고 이를 거의 다문 채"}),
            Map.entry("ㅣ", new String[] {"입술을 옆으로 펴고 혀를 앞으로 높여요", "입술을 옆으로 펴고 혀를 앞으로 높이고", "입술을 옆으로 펴고"}),
            Map.entry("ㅔ", new String[] {"입을 ㅣ보다 조금 더 벌려요", "입을 ㅣ보다 조금 더 벌리고", "입을 ㅣ보다 조금 더 벌리고"}),
            Map.entry("ㅐ", new String[] {"입을 ㅣ보다 조금 더 벌려요", "입을 ㅣ보다 조금 더 벌리고", "입을 ㅣ보다 조금 더 벌리고"}),
            Map.entry("ㅑ", new String[] {"ㅣ에서 ㅏ로 미끄러지듯 열어요", "ㅣ에서 ㅏ로 미끄러지듯 열고", "ㅣ에서 ㅏ로 미끄러지듯"}),
            Map.entry("ㅕ", new String[] {"ㅣ에서 ㅓ로 미끄러지듯 열어요", "ㅣ에서 ㅓ로 미끄러지듯 열고", "ㅣ에서 ㅓ로 미끄러지듯"}),
            Map.entry("ㅛ", new String[] {"ㅣ에서 ㅗ로 미끄러지며 입술을 모아요", "ㅣ에서 ㅗ로 미끄러지며 입술을 모으고", "ㅣ에서 ㅗ로 미끄러지듯"}),
            Map.entry("ㅠ", new String[] {"ㅣ에서 ㅜ로 미끄러지며 입술을 모아요", "ㅣ에서 ㅜ로 미끄러지며 입술을 모으고", "ㅣ에서 ㅜ로 미끄러지듯"}),
            Map.entry("ㅖ", new String[] {"ㅣ에서 ㅔ로 미끄러지듯 열어요", "ㅣ에서 ㅔ로 미끄러지듯 열고", "ㅣ에서 ㅔ로 미끄러지듯"}));

    private PronunciationAdvice() {
    }

    /**
     * @param word      칠한 어절(문장부호 뺀 것)
     * @param heardWord 소리 나는 대로 읽되 짚은 소리만 들린 소리로 바꾼 말
     * @param syllable  짚은 소리가 든 음절(소리 나는 대로). 예: 녕
     * @param open      그 음절의 받침 뺀 소리. 예: 녀
     * @return 설명할 수 없는 소리 쌍이면 {@code null}
     */
    static Detail of(String word, String heardWord, Slot slot, String expected, String heard, String syllable, String open) {
        String heardLine = "'" + heardWord + "'처럼 들렸어요";
        return switch (slot) {
            case VOWEL -> vowel(word, heardLine, expected, heard, syllable, open);
            case ONSET, CODA -> consonant(word, heardLine, slot, expected, heard, syllable, open);
        };
    }

    private static Detail consonant(String word, String heardLine, Slot slot, String expected, String heard, String syllable,
            String open) {
        Consonant e = CONSONANTS.get(expected);
        Consonant h = CONSONANTS.get(heard);
        if (e == null || h == null) {
            return null;
        }
        String position = slot == Slot.ONSET ? "첫소리" : "받침";
        String where = "'" + syllable + "'의 " + position + " " + expected + "이 " + heard + "에 가까웠어요";
        String kind = slot == Slot.ONSET ? "자음이 바뀜" : "받침이 바뀜";
        String diff;
        if (e.place() == h.place()) {
            diff = sameFamily(expected, e, heard, h);
        } else {
            String both = e.manner() == h.manner() && e.manner() == Manner.NASAL ? "둘 다 콧소리예요. " : "";
            diff = both + expected + "은 " + e.place().doesAnd + ", " + heard + "은 " + h.place().does + ".";
        }
        String lead = h.place() == Place.LIPS && e.place() != Place.LIPS ? "입술은 뗀 채 " : "";
        String then = word.equals(syllable) ? "." : ", 그다음 '" + word + "'.";
        String practice;
        if (slot == Slot.CODA) {
            String close = CODA_CLOSE.get(expected);
            if (close == null) {
                return null;
            }
            practice = "'" + open + "' 다음에 " + lead + close + " 끝내요. '" + syllable + "-" + syllable + "'" + then;
        } else {
            String action = e.place() == h.place() ? mannerAction(e.manner()) : lead + e.place().doing + manner(e, h);
            practice = action + " '" + open + "-" + open + "-" + syllable + "'" + then;
        }
        return new Detail(heardLine, where, kind, diff, practice);
    }

    /** 같은 자리에서 나는 두 자음 — 방법만 다르다. */
    private static String sameFamily(String expected, Consonant e, String heard, Consonant h) {
        return "같은 자리에서 나는 소리예요. " + expected + "은 " + mannerDoes(e.manner(), true) + ", " + heard + "은 "
                + mannerDoes(h.manner(), false) + ".";
    }

    private static String mannerDoes(Manner m, boolean and) {
        return switch (m) {
            case NASAL -> and ? "코로 소리를 내고" : "코로 소리를 내요";
            case LIQUID -> and ? "혀끝을 가볍게 굴리고" : "혀끝을 가볍게 굴려요";
            case LAX -> and ? "힘과 바람을 빼고 내고" : "힘과 바람을 빼고 내요";
            case ASPIRATED -> and ? "바람을 세게 내고" : "바람을 세게 내요";
            case TENSE -> and ? "목에 힘을 주고 바람 없이 내고" : "목에 힘을 주고 바람 없이 내요";
        };
    }

    /** 받침은 터뜨리지 않고 닫은 채 끝낸다(받침 대표음 7개). */
    private static final Map<String, String> CODA_CLOSE = Map.of(
            "ㄱ", "혀 뒤를 입천장 안쪽에 붙이며",
            "ㄴ", "혀끝을 윗잇몸에 붙인 채 코로 울리며",
            "ㄷ", "혀끝을 윗잇몸에 붙이며",
            "ㄹ", "혀끝을 윗잇몸에 가볍게 대며",
            "ㅁ", "두 입술을 닫은 채 코로 울리며",
            "ㅂ", "두 입술을 닫으며",
            "ㅇ", "혀 뒤를 입천장 안쪽에 붙인 채 코로 울리며");

    /** 자리가 같은 두 소리 — 연습은 내는 방법만 말한다. */
    private static String mannerAction(Manner m) {
        return switch (m) {
            case NASAL -> "코로 울리며";
            case LIQUID -> "혀끝을 가볍게 굴리며";
            case LAX -> "바람을 빼고 약하게";
            case ASPIRATED -> "바람을 세게 내며";
            case TENSE -> "목에 힘을 주고 단단하게";
        };
    }

    /** 연습 동작에 덧붙이는 방법. 자리가 같으면 방법이 핵심이라 더 분명히 쓴다. */
    private static String manner(Consonant e, Consonant h) {
        if (e.manner() == h.manner()) {
            return "";
        }
        return switch (e.manner()) {
            case NASAL -> " 코로 울리며";
            case LIQUID -> " 가볍게 굴리며";
            case LAX -> " 힘을 빼고";
            case ASPIRATED -> " 바람을 세게";
            case TENSE -> " 목에 힘을 주고";
        };
    }

    private static Detail vowel(String word, String heardLine, String expected, String heard, String syllable, String open) {
        String[] e = VOWELS.get(expected);
        String[] h = VOWELS.get(heard);
        if (e == null || h == null) {
            return null;
        }
        String where = "'" + syllable + "'의 모음 " + expected + "가 " + heard + "에 가까웠어요";
        String diff = expected + "는 " + e[1] + ", " + heard + "는 " + h[0] + ".";
        String practice = e[2] + " '" + open + "-" + open + "-" + syllable + "', 그다음 '" + word + "'.";
        return new Detail(heardLine, where, "모음이 바뀜", diff, practice);
    }
}
