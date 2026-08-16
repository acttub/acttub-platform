package com.acttub.actingapi.integration.llm;

import java.io.IOException;

@FunctionalInterface
interface OpenAiHttpTransport {
    OpenAiHttpResponse exchange(OpenAiHttpRequest request) throws IOException;
}
