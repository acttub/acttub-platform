package com.acttub.actingapi.operation;

import org.springframework.http.ResponseEntity;

public record SyncOperationBegin(
        SyncOperationClaim claim,
        ResponseEntity<byte[]> replay) {

    public static SyncOperationBegin claimed(SyncOperationClaim claim) {
        return new SyncOperationBegin(claim, null);
    }

    public static SyncOperationBegin replayed(ResponseEntity<byte[]> response) {
        return new SyncOperationBegin(null, response);
    }

    public boolean isReplay() {
        return replay != null;
    }
}
