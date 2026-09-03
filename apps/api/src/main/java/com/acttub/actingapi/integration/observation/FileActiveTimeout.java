package com.acttub.actingapi.integration.observation;

import com.acttub.actingapi.platform.observability.ExternalFailure;

public class FileActiveTimeout extends RuntimeException implements ExternalFailure {
    public FileActiveTimeout(String message) {
        super(message);
    }
}
