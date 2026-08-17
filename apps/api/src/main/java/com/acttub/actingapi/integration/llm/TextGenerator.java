package com.acttub.actingapi.integration.llm;

@FunctionalInterface
public interface TextGenerator {
    GeneratedText generate(String instructions, String input);
}
