// 하단 사업자 정보. 보이는 사업자등록번호로 공정위 조회를 여는 링크, 보이는 이메일로 메일을 여는 링크가 실제로
// 같은 값을 가리키는지, 어두운 바탕(랜딩)에서도 같은 내용을 보이는지 본다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";

const { cleanup, render, screen } = await import("@testing-library/react");
const { BusinessInfo } = await import("../src/features/business-info/business-info.tsx");

const h = react.createElement;

afterEach(cleanup);

for (const tone of ["light", "dark"]) {
  test(`사업자 정보(${tone}): 등록번호 조회 링크와 메일 링크가 화면에 적힌 번호·주소를 가리키고 칸마다 값이 있다`, () => {
    const view = render(h(BusinessInfo, { tone }));

    const lines = [...view.container.querySelectorAll("p")].map((line) => line.textContent);
    // 칸마다 이름표와 값이 함께 보인다(값 자체는 BUSINESS_INFO 한 곳이 정한다).
    assert.deepEqual(
      lines.map((line) => line.match(/[^:|]+:/g).map((label) => label.trim())),
      [["상호:", "대표자:"], ["사업자등록번호:"], ["통신판매업 신고번호:"], ["사업장 주소:"], ["전화:", "이메일:"]],
    );
    assert.equal(lines.every((line) => !/:\s*(\||$)/.test(line)), true);

    assert.equal(lines[2], "통신판매업 신고번호: 2026-서울동대문-1884");

    const check = screen.getByRole("link", { name: "사업자정보 확인" });
    const shownNumber = lines[1].match(/\d{3}-\d{2}-\d{5}/)[0];
    assert.equal(new URL(check.getAttribute("href")).searchParams.get("wrkr_no"), shownNumber.replaceAll("-", ""));
    assert.equal(check.getAttribute("target"), "_blank");
    assert.equal(check.getAttribute("rel"), "noreferrer");

    const shownEmail = lines[4].split("이메일: ")[1];
    const mail = screen.getByRole("link", { name: shownEmail });
    assert.equal(mail.getAttribute("href"), `mailto:${shownEmail}`);
  });
}
