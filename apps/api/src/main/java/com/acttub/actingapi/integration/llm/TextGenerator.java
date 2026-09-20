package com.acttub.actingapi.integration.llm;

@FunctionalInterface
public interface TextGenerator {
    GeneratedText generate(String instructions, String input);

    default GeneratedText generate(String instructions, String input, GenerationOptions options) {
        return generate(instructions, input);
    }
}
