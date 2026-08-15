import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { parseInline, parseMarkdown } = await import("../src/lib/markdown.ts");

/** 목록 항목은 대부분 자식이 없어서, 기대값을 짧게 쓰려고 감싼다. */
function item(spans, children = []) {
  return { spans, children };
}

test("굵게·기울임·코드·링크를 스팬으로 쪼갠다", () => {
  assert.deepEqual(parseInline("의도가 **안 닿았어요**"), [
    { text: "의도가 " },
    { text: "안 닿았어요", bold: true },
  ]);
  assert.deepEqual(parseInline("*조금* 더"), [{ text: "조금", italic: true }, { text: " 더" }]);
  assert.deepEqual(parseInline("`code` 확인"), [
    { text: "code", code: true },
    { text: " 확인" },
  ]);
  assert.deepEqual(parseInline("[약관](https://acttub.com/terms)"), [
    { text: "약관", href: "https://acttub.com/terms" },
  ]);
});

test("마크업이 없으면 통짜 텍스트 스팬 하나다", () => {
  assert.deepEqual(parseInline("그냥 문장"), [{ text: "그냥 문장" }]);
});

test("제목은 깊이와 함께 heading 블록이 된다", () => {
  assert.deepEqual(parseMarkdown("# 이용약관\n## 제1조\n### 목적"), [
    { type: "heading", depth: 1, spans: [{ text: "이용약관" }] },
    { type: "heading", depth: 2, spans: [{ text: "제1조" }] },
    { type: "heading", depth: 3, spans: [{ text: "목적" }] },
  ]);
});

test("연속된 - 줄은 하나의 목록으로 묶인다", () => {
  assert.deepEqual(parseMarkdown("- 첫째\n- 둘째"), [
    {
      type: "list",
      ordered: false,
      items: [item([{ text: "첫째" }]), item([{ text: "둘째" }])],
    },
  ]);
});

test("1. 로 시작하면 순서 있는 목록이다", () => {
  assert.deepEqual(parseMarkdown("1. 하나\n2. 둘"), [
    {
      type: "list",
      ordered: true,
      items: [item([{ text: "하나" }]), item([{ text: "둘" }])],
    },
  ]);
});

test("들여쓴 목록은 위 항목의 자식이 된다", () => {
  // 이용약관 제4조·제5조가 "다음 각 호" 아래에 하위 항목을 다는 형태다. 평탄화하면
  // 어느 조항에 걸린 항목인지 사라져서 계층을 지킨다.
  assert.deepEqual(parseMarkdown("1. 승낙을 거절합니다.\n   - 명의를 도용한 경우\n   - 만 14세 미만인 경우"), [
    {
      type: "list",
      ordered: true,
      items: [
        item([{ text: "승낙을 거절합니다." }], [
          {
            type: "list",
            ordered: false,
            items: [
              item([{ text: "명의를 도용한 경우" }]),
              item([{ text: "만 14세 미만인 경우" }]),
            ],
          },
        ]),
      ],
    },
  ]);
});

test("표는 헤더와 행으로 나뉜다", () => {
  // 개인정보처리방침의 수탁자 표. 표를 못 읽으면 파이프까지 포함해 한 문단으로 뭉개진다.
  assert.deepEqual(
    parseMarkdown("| 수탁자 | 위탁 업무 |\n| --- | --- |\n| Google | AI 분석 처리 |\n| AWS | 클라우드 저장 |"),
    [
      {
        type: "table",
        header: [[{ text: "수탁자" }], [{ text: "위탁 업무" }]],
        rows: [
          [[{ text: "Google" }], [{ text: "AI 분석 처리" }]],
          [[{ text: "AWS" }], [{ text: "클라우드 저장" }]],
        ],
      },
    ],
  );
});

test("구분선이 없는 파이프 줄은 표가 아니라 문단이다", () => {
  assert.deepEqual(parseMarkdown("| 그냥 | 텍스트 |"), [
    { type: "paragraph", spans: [{ text: "| 그냥 | 텍스트 |" }] },
  ]);
});

test("표 셀 안의 인라인 마크업도 살아 있다", () => {
  const blocks = parseMarkdown("| 항목 | 값 |\n| --- | --- |\n| **보관** | 탈퇴 시까지 |");
  assert.deepEqual(blocks[0].rows[0][0], [{ text: "보관", bold: true }]);
});

test("빈 줄로 나뉜 문단은 각각의 블록이고, 이어진 줄은 한 문단으로 합쳐진다", () => {
  assert.deepEqual(parseMarkdown("첫 문단\n이어지는 줄\n\n두 번째 문단"), [
    { type: "paragraph", spans: [{ text: "첫 문단 이어지는 줄" }] },
    { type: "paragraph", spans: [{ text: "두 번째 문단" }] },
  ]);
});

test("인용과 구분선을 알아본다", () => {
  assert.deepEqual(parseMarkdown("> 인용문\n\n---"), [
    { type: "quote", spans: [{ text: "인용문" }] },
    { type: "rule" },
  ]);
});

test("목록 다음에 오는 문단은 목록에 흡수되지 않는다", () => {
  assert.deepEqual(parseMarkdown("- 항목\n일반 문장"), [
    { type: "list", ordered: false, items: [item([{ text: "항목" }])] },
    { type: "paragraph", spans: [{ text: "일반 문장" }] },
  ]);
});

test("실제 동의 문서 형태를 통째로 파싱한다", () => {
  const doc = [
    "# 개인정보 처리방침",
    "",
    "## 1. 수집 항목",
    "- 이메일",
    "- 연습 영상",
    "",
    "**보관 기간**은 탈퇴 시까지입니다.",
  ].join("\n");

  assert.deepEqual(parseMarkdown(doc), [
    { type: "heading", depth: 1, spans: [{ text: "개인정보 처리방침" }] },
    { type: "heading", depth: 2, spans: [{ text: "1. 수집 항목" }] },
    {
      type: "list",
      ordered: false,
      items: [item([{ text: "이메일" }]), item([{ text: "연습 영상" }])],
    },
    {
      type: "paragraph",
      spans: [{ text: "보관 기간", bold: true }, { text: "은 탈퇴 시까지입니다." }],
    },
  ]);
});

test("빈 문자열·공백은 블록을 만들지 않는다", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("\n\n  \n"), []);
});
