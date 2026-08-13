package com.acttub.actingapi.llm;

import java.io.IOException;

@FunctionalInterface
interface OpenAiHttpTransport {
    OpenAiHttpResponse exchange(OpenAiHttpRequest request) throws IOException;
}
