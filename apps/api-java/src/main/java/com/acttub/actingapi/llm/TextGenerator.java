package com.acttub.actingapi.llm;

@FunctionalInterface
public interface TextGenerator {
    GeneratedText generate(String instructions, String input);
}
