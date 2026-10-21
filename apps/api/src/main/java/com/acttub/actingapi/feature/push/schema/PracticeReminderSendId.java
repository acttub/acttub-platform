package com.acttub.actingapi.feature.push.schema;

import java.io.Serializable;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

public class PracticeReminderSendId implements Serializable {
    private UUID userId;
    private LocalDate day;
    private String slot;

    public PracticeReminderSendId() {}

    @Override public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof PracticeReminderSendId that)) return false;
        return Objects.equals(userId, that.userId) && Objects.equals(day, that.day) && Objects.equals(slot, that.slot);
    }

    @Override public int hashCode() { return Objects.hash(userId, day, slot); }
}
