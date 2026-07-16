const numberOfRuns = Number(process.env.LHCI_RUNS ?? "3");

if (!Number.isInteger(numberOfRuns) || numberOfRuns < 1) {
  throw new Error("LHCI_RUNS must be a positive integer.");
}

module.exports = {
  ci: {
    collect: {
      numberOfRuns,
      url: ["http://127.0.0.1:4317/"],
      startServerCommand:
        "pnpm --filter web start --hostname 127.0.0.1 --port 4317",
      startServerReadyPattern: "Ready in",
      startServerReadyTimeout: 60_000,
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
