// Lighthouse CI budgets for the staged static site (`_site`), run by the Verify job
// and locally with `npm run test:lighthouse` after staging the site.
// Lighthouse's default mobile emulation and simulated throttling apply.
module.exports = {
  ci: {
    collect: {
      staticDistDir: "./_site",
      url: ["http://localhost/"],
      // The first run on a shared runner can carry cold-start blocking time; the median of
      // five runs tolerates two such outliers.
      numberOfRuns: 5
    },
    assert: {
      aggregationMethod: "median-run",
      assertions: {
        "categories:performance": ["error", { minScore: 0.95 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["error", { minScore: 0.95 }],
        "total-byte-weight": ["error", { maxNumericValue: 512000 }],
        "largest-contentful-paint": ["error", { maxNumericValue: 2000 }]
      }
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci/reports"
    }
  }
};
