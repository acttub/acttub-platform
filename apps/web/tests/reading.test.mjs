// 상대역 리딩 로직 테스트 — 파서·상태머신·침묵 감지·글자 대조·음성인식·목소리 배정.
// rehearsal-web(read_tts)에서 vitest 로 쓰던 것을 tests/reading/expect.ts 셈 위에서 그대로 돌린다.
import "./ts-module-loader.mjs";
import "./dom-setup.mjs";

await import("./reading/parse.test.ts");
await import("./reading/machine.test.ts");
await import("./reading/vad.test.ts");
await import("./reading/match.test.ts");
await import("./reading/stt.test.ts");
await import("./reading/stt.dedupe.test.ts");
await import("./reading/tts.test.ts");
