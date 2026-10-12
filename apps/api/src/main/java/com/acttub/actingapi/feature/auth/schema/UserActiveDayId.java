package com.acttub.actingapi.feature.auth.schema;

import java.io.Serializable;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

public class UserActiveDayId implements Serializable {
    private UUID userId;
    private LocalDate day;

    public UserActiveDayId() {}

    @Override public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof UserActiveDayId that)) return false;
        return Objects.equals(userId, that.userId) && Objects.equals(day, that.day);
    }

    @Override public int hashCode() { return Objects.hash(userId, day); }
}
