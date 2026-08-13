package com.acttub.actingapi.llm;

import java.net.URI;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;

record OpenAiHttpRequest(URI uri, Map<String, String> headers, JsonNode body) {
}
