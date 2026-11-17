// @ts-check
import { analyzeContent } from '../src/engine.mjs';

/** @returns {import('../src/config.mjs').SmuganConfig} */
export function testConfig(overrides = {}) {
  return {
    root: '.',
    ignore: [],
    // The Supabase checks opt in here; their stack detection has its own tests.
    checks: { rls: true, 'rls-tests': true, 'security-notes': true, 'anon-grants': true },
    mode: 'block',
    disable: [],
    hook: {
      eslint: true,
      typecheck: true,
      timeoutMs: 30000,
      stop: { smugan: true, typecheck: true, tests: true, timeoutMs: 120000 },
    },
    ...overrides,
  };
}

/**
 * @param {string} path
 * @param {string} content
 * @param {Record<string, unknown>} [checks]
 */
export function run(path, content, checks = {}) {
  return analyzeContent(path, content, testConfig({ checks: { ...testConfig().checks, ...checks } }));
}

/** @param {import('../src/engine.mjs').Violation[]} violations @param {string} rule */
export function ofRule(violations, rule) {
  return violations.filter((v) => v.rule === rule);
}
