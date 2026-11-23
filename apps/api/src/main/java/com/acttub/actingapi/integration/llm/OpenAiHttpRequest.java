package com.acttub.actingapi.integration.llm;

import java.net.URI;
import java.util.Map;

import tools.jackson.databind.JsonNode;

record OpenAiHttpRequest(URI uri, Map<String, String> headers, JsonNode body) {
}
