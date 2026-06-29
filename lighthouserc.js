export default {
  ci: {
    collect: { staticDistDir: './dist', numberOfRuns: 3 },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.8 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.1 }],
        'total-byte-weight': ['warn', { maxNumericValue: 600000 }],
      },
    },
    upload: { target: 'temporary-public-storage' },
  },
};
