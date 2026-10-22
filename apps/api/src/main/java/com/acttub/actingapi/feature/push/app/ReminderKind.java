package com.acttub.actingapi.feature.push.app;

/** 연습 알림의 종류. {@link #wire()} 가 푸시 data 의 {@code kind} 값이다. */
public enum ReminderKind {
    RESUME("resume"),
    PENDING_VIDEO("pending_video"),
    UNREAD_SCRIPT("unread_script"),
    HOMEWORK("homework"),
    READING("reading"),
    GENERAL("general"),
    FIRST_PRACTICE("first_practice"),
    STREAK("streak");

    private final String wire;

    ReminderKind(String wire) { this.wire = wire; }

    public String wire() { return wire; }

    /** 보낸 기록의 칸. 연속 기록 알림만 'streak', 나머지는 'practice' 칸을 쓴다. */
    public String slot() { return this == STREAK ? "streak" : "practice"; }
}
