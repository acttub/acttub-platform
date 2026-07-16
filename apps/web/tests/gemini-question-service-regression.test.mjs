import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const webRoot = path.resolve(import.meta.dirname, "..");
const servicePath = path.join(
  webRoot,
  "src/server/services/gemini-question-service.ts",
);

function loadTypeScriptModule(filename, stubs) {
  const source = readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  const cjsModule = { exports: {} };
  const localRequire = (specifier) =>
    Object.hasOwn(stubs, specifier) ? stubs[specifier] : require(specifier);
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module) {${compiled.outputText}\n})`,
    { filename },
  );
  wrapper(cjsModule.exports, localRequire, cjsModule);
  return cjsModule.exports;
}

const policyStub = {
  MAX_DIALOGUE_ANSWER_COUNT: 10,
  MIN_DIALOGUE_ANSWER_COUNT: 5,
  matchesRequiredDialogueSufficiency: () => true,
  requiredDialogueSufficiencyForAnswerCount: () => null,
};

const { GeminiQuestionServiceError, geminiQuestionService } = loadTypeScriptModule(
  servicePath,
  {
    "server-only": {},
    "@/lib/practice/dialogue-completion-policy": policyStub,
  },
);

const initialInput = {
  genre: "드라마",
  situation: "인물이 떠나기 직전 망설이는 장면",
  characterContext: "오랜 친구에게 마지막 말을 건네려 한다",
  subtext: "붙잡아 주기를 바란다",
};

async function createInitialQuestion(question) {
  const previousFetch = globalThis.fetch;
  const previousApiKey = process.env.GEMINI_API_KEY;
  const previousGoogleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.GEMINI_API_KEY = "test-api-key";
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        output_text: JSON.stringify({
          observationText: "인물이 마지막 말을 앞두고 망설이는 지점을 확인합니다.",
          confidence: 0.8,
          question,
          questionFocus: "observation_confirmation",
        }),
      };
    },
  });

  try {
    return await geminiQuestionService.createInitialQuestion(initialInput);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
    if (previousGoogleApiKey === undefined) {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    } else {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousGoogleApiKey;
    }
  }
}

async function assertRejected(question) {
  await assert.rejects(
    () => createInitialQuestion(question),
    (error) => error instanceof GeminiQuestionServiceError,
  );
}

test("normalizes harmless outer and internal whitespace to one line", async () => {
  const outer = await createInitialQuestion("\n그 장면에서 왜 멈추었나요?\n");
  assert.equal(outer.question, "그 장면에서 왜 멈추었나요?");

  const internal = await createInitialQuestion(
    "그 장면에서\n왜\r\n멈추고\t  다시   바라보았나요?",
  );
  assert.equal(
    internal.question,
    "그 장면에서 왜 멈추고 다시 바라보았나요?",
  );
});

test("rejects bullets and every form of multiple question marks", async () => {
  await assertRejected("그 장면에서 • 왜 멈추었나요?");
  await assertRejected("그 장면에서 왜 멈추었나요? 다시 보았나요?");
  await assertRejected("그 장면에서 왜 멈추었나요？ 다시 보았나요？");
  await assertRejected("그 장면에서 왜 멈추었나요? 다시 보았나요？");
});

test("rejects forbidden Korean and English product language after normalization", async () => {
  await assertRejected("그 장면을\n평가해 달라는 뜻인가요?");
  await assertRejected("그 장면의 score 를 말해 주시겠나요?");
});

test("enforces normalized question length boundaries", async () => {
  assert.equal((await createInitialQuestion(`${"가".repeat(7)}?`)).question.length, 8);
  assert.equal((await createInitialQuestion(`${"가".repeat(219)}?`)).question.length, 220);
  await assertRejected(`${"가".repeat(6)}?`);
  await assertRejected(`${"가".repeat(220)}?`);
});

test("appends one ASCII question mark when a valid question has none", async () => {
  const result = await createInitialQuestion("그 장면에서 멈춘 이유를 말해 주세요");
  assert.equal(result.question, "그 장면에서 멈춘 이유를 말해 주세요?");
});
