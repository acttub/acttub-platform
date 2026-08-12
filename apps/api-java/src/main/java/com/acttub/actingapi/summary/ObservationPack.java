package com.acttub.actingapi.summary;

import java.util.List;

public record ObservationPack(
        List<ObservationItem> observations,
        List<String> uncertainties) {

    public ObservationPack {
        observations = observations == null ? List.of() : List.copyOf(observations);
        uncertainties = uncertainties == null ? List.of() : List.copyOf(uncertainties);
    }
}
