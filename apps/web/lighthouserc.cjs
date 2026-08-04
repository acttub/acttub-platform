const numberOfRuns = Number(process.env.LHCI_RUNS ?? "3");

if (!Number.isInteger(numberOfRuns) || numberOfRuns < 1) {
  throw new Error("LHCI_RUNS must be a positive integer.");
}

module.exports = {
  ci: {
    collect: {
      numberOfRuns,
      // 정적 export(out/)를 없앤 뒤로는 실제 배포 형태와 같은 Next 서버를 띄워
      // 측정한다. standalone 산출물을 직접 실행하지 않는 이유는 정적 자산
      // (.next/static·public)이 거기에 자동 포함되지 않아 배포 스크립트가 하는
      // 수동 복사를 여기서도 재현해야 하기 때문이다. `next start`는 빌드 결과를
      // 그대로 서빙하므로 그 과정이 필요 없다.
      // 3000 포트를 쓰므로 `pnpm dev`가 떠 있으면 먼저 내려야 한다.
      startServerCommand: "pnpm --filter web start",
      startServerReadyPattern: "Ready in",
      url: ["http://localhost:3000/"],
      settings: {
        onlyCategories: ["performance"],
        throttlingMethod: "simulate",
      },
    },
    assert: {
      includePassedAssertions: true,
      assertions: {
        "categories:performance": [
          "error",
          { aggregationMethod: "median", minScore: 0.9 },
        ],
        "largest-contentful-paint": [
          "error",
          { aggregationMethod: "median", maxNumericValue: 2_500 },
        ],
        "cumulative-layout-shift": [
          "error",
          { aggregationMethod: "median", maxNumericValue: 0.1 },
        ],
        "total-blocking-time": [
          "error",
          { aggregationMethod: "median", maxNumericValue: 200 },
        ],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "apps/web/artifacts/lighthouse/mobile",
    },
  },
};
