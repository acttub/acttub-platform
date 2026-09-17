package com.acttub.actingapi.feature.report.app;

/** Recognizes explicit, short reports of felt experience; not a general intent classifier. */
public final class ActorExperience {
    private ActorExperience() { }

    public static boolean onlyExperience(String text) {
        String value = text.strip();
        if (value.contains("?") || value.contains("？")) return false;
        if (value.matches("(?s).*(?:싶|원해|원하|유지|바꾸|고치|해볼|해 볼).*")) return false;
        return value.matches("(?s).*(?:편했|급했|좋았|어색했|불편했|힘들었|느꼈)(?:어|어요)[.!?\\s]*");
    }
}
