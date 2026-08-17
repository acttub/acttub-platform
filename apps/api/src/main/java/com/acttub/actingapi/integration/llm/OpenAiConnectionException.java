package com.acttub.actingapi.integration.llm;

public class OpenAiConnectionException extends RuntimeException {
    public OpenAiConnectionException(Throwable cause) {
        super(cause);
    }
}
