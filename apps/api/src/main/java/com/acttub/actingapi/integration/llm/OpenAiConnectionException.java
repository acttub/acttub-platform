package com.acttub.actingapi.integration.llm;

import com.acttub.actingapi.platform.observability.ExternalFailure;

public class OpenAiConnectionException extends RuntimeException implements ExternalFailure {
    public OpenAiConnectionException(Throwable cause) {
        super(cause);
    }
}
