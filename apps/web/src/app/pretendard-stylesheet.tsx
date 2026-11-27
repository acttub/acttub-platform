import pretendardPackage from "pretendard/package.json" with { type: "json" };

const fontRoot = `/fonts/pretendard/${pretendardPackage.version}`;
const stylesheetHref = `${fontRoot}/pretendard.css`;

// 동적 서브셋은 번호가 클수록 자주 쓰는 글자를 담는다. 91은 라틴·문장부호와 최빈 한글,
// 90·89는 그다음 빈도 한글이라 첫 화면 글자 대부분이 여기서 나온다(셋을 합쳐 약 80KB).
// 미리 받아 두면 font-display: optional 의 짧은 대기 안에 도착해 시스템 글꼴로 그렸다가
// 바꿔 끼우는 일이 없다. 나머지 서브셋은 unicode-range 대로 필요할 때만 받는다.
const preloadSubsets = [91, 90, 89];

/**
 * Pretendard 동적 서브셋 시트를 서버 렌더 <head> 에 싣는다.
 *
 * 하이드레이션 뒤에 시트를 붙이면 첫 페인트가 시스템 글꼴로 나가고, 서브셋 조각이
 * 도착하는 대로 글자가 하나씩 바뀌어 보인다(2026-11-27 QA). 그래서 첫 페인트 전에
 * 받도록 평범한 스타일시트로 건다. 자가 호스팅 경로와 immutable 캐시는 그대로다.
 */
export function PretendardStylesheet() {
  return (
    <>
      {preloadSubsets.map((subset) => (
        <link
          key={subset}
          rel="preload"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
          href={`${fontRoot}/woff2-dynamic-subset/PretendardVariable.subset.${subset}.woff2`}
        />
      ))}
      {/* 버전 경로의 정적 자산이라 CSS import 로 번들에 넣지 않는다. */}
      <link rel="stylesheet" href={stylesheetHref} />
    </>
  );
}
