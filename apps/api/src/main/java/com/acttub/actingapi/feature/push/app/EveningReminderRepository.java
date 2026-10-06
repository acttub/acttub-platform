package com.acttub.actingapi.feature.push.app;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public interface EveningReminderRepository {
    List<PushTarget> claimTargets(LocalDate day, Instant dayStart, Instant dayEnd, Instant recentSince,
                                  String minimumAppVersion);
}
