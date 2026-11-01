// account.consent: 동의 문서·처리방침 본문(서버가 주는 마크다운 원문)을 공개 페이지와 동의 시트가 그리는 방식.
// 파싱 규칙은 markdown.test.mjs 가 맡고, 여기서는 그려진 결과를 보조기기가 읽는 역할로 확인한다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";

const { cleanup, render, screen, within } = await import("@testing-library/react");
const { ConsentMarkdown } = await import("../src/features/consent/consent-markdown.tsx");

afterEach(cleanup);

const draw = (source) => render(react.createElement(ConsentMarkdown, { source }));

test("문서 안의 제목은 카드 제목(h2) 아래 단계인 h3·h4·h5 로 그린다", () => {
  draw("# 개인정보 처리방침\n## 1. 수집 항목\n### 가. 필수 항목");

  assert.equal(screen.getByRole("heading", { level: 3 }).textContent, "개인정보 처리방침");
  assert.equal(screen.getByRole("heading", { level: 4 }).textContent, "1. 수집 항목");
  assert.equal(screen.getByRole("heading", { level: 5 }).textContent, "가. 필수 항목");
  assert.equal(screen.queryByRole("heading", { level: 2 }), null);
});

test("문단 안의 링크는 새 창으로 열고, 굵게·기울임·코드는 강조로 남는다", () => {
  draw("자세한 내용은 [고객센터](https://acttub.com/help)에서 **보관 기간**과 *파기 절차*, `privacy@acttub.com` 을 확인하세요.");

  const link = screen.getByRole("link", { name: "고객센터" });
  assert.equal(link.getAttribute("href"), "https://acttub.com/help");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  assert.equal(screen.getByRole("strong").textContent, "보관 기간");
  assert.equal(screen.getByRole("emphasis").textContent, "파기 절차");
  assert.equal(screen.getByRole("code").textContent, "privacy@acttub.com");
  assert.equal(
    screen.getByRole("paragraph").textContent,
    "자세한 내용은 고객센터에서 보관 기간과 파기 절차, privacy@acttub.com 을 확인하세요.",
  );
});

test("이용약관의 '다음 각 호' 하위 항목은 위 조항 안의 목록으로 남는다", () => {
  draw("1. 승낙을 거절할 수 있습니다.\n   - 명의를 도용한 경우\n   - 만 14세 미만인 경우\n2. 그 밖의 경우");

  const [outer, inner] = screen.getAllByRole("list");
  assert.equal(outer.tagName, "OL");
  const clauses = within(outer).getAllByRole("listitem").filter((item) => item.parentElement === outer);
  assert.equal(clauses.length, 2);
  assert.equal(inner.tagName, "UL");
  assert.equal(inner.closest("li"), clauses[0]);
  assert.deepEqual(
    within(inner).getAllByRole("listitem").map((item) => item.textContent),
    ["명의를 도용한 경우", "만 14세 미만인 경우"],
  );
  assert.equal(clauses[1].textContent, "그 밖의 경우");
});

test("처리방침의 수탁자 표는 머리글과 칸이 있는 표로 그린다", () => {
  draw("| 수탁자 | 위탁 업무 |\n| --- | --- |\n| Google | **AI 분석** 처리 |\n| AWS | 클라우드 저장 |");

  const table = screen.getByRole("table");
  assert.deepEqual(
    within(table).getAllByRole("columnheader").map((cell) => cell.textContent),
    ["수탁자", "위탁 업무"],
  );
  const rows = within(table).getAllByRole("row").slice(1);
  assert.deepEqual(
    rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent)),
    [["Google", "AI 분석 처리"], ["AWS", "클라우드 저장"]],
  );
  assert.equal(within(rows[0]).getByRole("strong").textContent, "AI 분석");
});

test("인용과 구분선을 알아볼 수 있게 그린다", () => {
  draw("> 이 문서는 2026년 9월 1일부터 적용합니다.\n\n---\n\n부칙");

  assert.equal(screen.getByRole("blockquote").textContent, "이 문서는 2026년 9월 1일부터 적용합니다.");
  assert.equal(screen.getAllByRole("separator").length, 1);
  assert.equal(screen.getByRole("paragraph").textContent, "부칙");
});

test("본문에 섞인 HTML 은 요소가 되지 않고 글자 그대로 보인다", () => {
  const { container } = draw('<img src="x" onerror="alert(1)">\n\n<a href="javascript:alert(1)">눌러 보세요</a>');

  assert.equal(container.querySelector("img"), null);
  assert.equal(screen.queryByRole("link"), null);
  assert.deepEqual(
    screen.getAllByRole("paragraph").map((node) => node.textContent),
    ['<img src="x" onerror="alert(1)">', '<a href="javascript:alert(1)">눌러 보세요</a>'],
  );
});
