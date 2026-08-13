package com.acttub.actingapi.coach;

/** stale coach-session snapshot이 저장된 turn을 덮으려 할 때 발생한다. */
public class SessionWriteConflict extends RuntimeException {

    public SessionWriteConflict(String message) {
        super(message);
    }
}
