package com.acttub.actingapi.platform.ledger;

/** Python 의 {@code LeaseOwnershipError} 대응. 리스를 이미 다른 워커가 재선점했다. */
public class LeaseOwnershipException extends RuntimeException {

    public LeaseOwnershipException(String message) {
        super(message);
    }
}
