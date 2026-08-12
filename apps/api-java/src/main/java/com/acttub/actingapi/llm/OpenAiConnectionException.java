package com.acttub.actingapi.llm;

public class OpenAiConnectionException extends RuntimeException {
    public OpenAiConnectionException(Throwable cause) {
        super(cause);
    }
}
