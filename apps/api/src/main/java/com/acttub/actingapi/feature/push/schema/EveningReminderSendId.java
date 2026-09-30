package com.acttub.actingapi.feature.push.schema;

import java.io.Serializable;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

public class EveningReminderSendId implements Serializable {
    private UUID userId;
    private LocalDate day;

    public EveningReminderSendId() {}

    @Override public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof EveningReminderSendId that)) return false;
        return Objects.equals(userId, that.userId) && Objects.equals(day, that.day);
    }

    @Override public int hashCode() { return Objects.hash(userId, day); }
}
