package com.acttub.actingapi.feature.ads.schema;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** {@code ad_settings}(V78) — 빈도 상한 숫자 한 줄(id 1). 쓰기는 HQL {@code insert … on conflict (id) do update} 뿐이다. */
@Entity
@Table(name = "ad_settings")
public class AdSettingsEntity {

    @Id
    @Column(name = "id", nullable = false)
    private int id;

    @Column(name = "window_minutes", nullable = false)
    private int windowMinutes;

    @Column(name = "window_cap", nullable = false)
    private int windowCap;

    @Column(name = "first_day_cap", nullable = false)
    private int firstDayCap;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected AdSettingsEntity() {
    }

    public int getWindowMinutes() {
        return windowMinutes;
    }

    public int getWindowCap() {
        return windowCap;
    }

    public int getFirstDayCap() {
        return firstDayCap;
    }
}
