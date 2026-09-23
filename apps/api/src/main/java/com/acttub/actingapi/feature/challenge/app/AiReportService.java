package com.acttub.actingapi.feature.challenge.app;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.platform.web.CanonicalJson;
import org.springframework.stereotype.Service;

/** AI 리포트 요청·조회 (challenge.ai-report). 만들기는 {@link ChallengeReportWorker} 가 뒤에서 한다. */
@Service
public class AiReportService {
    private final AiReportRepository reports;
    private final CanonicalJson canonical;
    private final Clock clock;

    public AiReportService(AiReportRepository reports, CanonicalJson canonical, Clock clock) {
        this.reports = reports; this.canonical = canonical; this.clock = clock;
    }

    public AiReportRepository.Requested request(UUID owner, UUID entryId, UUID requestId) {
        return reports.request(owner, entryId, requestId, fingerprint(List.of("challenge_report", entryId.toString())),
                clock.instant());
    }

    public AiReportRepository.Report find(UUID owner, UUID entryId) { return reports.find(owner, entryId); }

    private String fingerprint(Object body) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.bytes(body))); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
