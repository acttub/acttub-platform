package com.acttub.actingapi.platform.observability;

import java.net.ConnectException;
import java.net.http.HttpTimeoutException;
import java.sql.SQLException;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;
import java.util.concurrent.TimeoutException;

import org.springframework.dao.DataAccessException;
import software.amazon.awssdk.core.exception.SdkException;

public final class FailureClassifier {
    private FailureClassifier() {
    }

    public static FailureKind classify(Throwable failure) {
        Set<Throwable> visited = Collections.newSetFromMap(new IdentityHashMap<>());
        Throwable current = failure;
        while (current != null && visited.add(current)) {
            if (isExternal(current)) {
                return FailureKind.EXTERNAL;
            }
            current = current.getCause();
        }
        return FailureKind.UNEXPECTED;
    }

    private static boolean isExternal(Throwable failure) {
        return failure instanceof ExternalFailure
                || failure instanceof SdkException
                || failure instanceof DataAccessException
                || failure instanceof SQLException
                || failure instanceof TimeoutException
                || failure instanceof HttpTimeoutException
                || failure instanceof ConnectException;
    }
}
