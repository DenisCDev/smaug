// @ts-check
// `smugan init` — scaffolds the Tier 2 verification harness into a project.
// Idempotent by design: NEVER overwrites a file the user already has.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_FILES, LOCAL_CONFIG_FILE } from './config.mjs';
import { declaredDeps, isSupabaseProject } from './stack.mjs';

const TEMPLATE_CONFIG = {
  ignore: [],
  checks: {
    // rls, rls-tests, security-notes and anon-grants are left to detection:
    // on by default only where the project uses Supabase.
    'db-naming': true,
    'no-any': true,
    secrets: true,
    'console-log': true,
    'dead-imports': true,
    'stale-mutation': true,
    'test-weakening': true,
    'assertion-weakening': true,
    'money-float': true,
    'empty-catch': true,
    'fetch-timeout': true,
  },
  hook: {
    eslint: true,
    typecheck: true,
    timeoutMs: 30000,
    stop: { smugan: true, typecheck: true, tests: true, build: false, timeoutMs: 120000 },
  },
};

// [template-relative source, project-relative destination]
// Each group is copied only when the project already has its stack: the
// scaffolding never adds a dependency the project did not choose.
/** @type {{ needs: string, has: (cwd: string) => boolean, files: [string, string][] }[]} */
const GROUPS = [
  {
    needs: 'Supabase (supabase/config.toml or an @supabase/* dependency)',
    has: isSupabaseProject,
    files: [
      ['supabase-tests/000-setup.sql', 'supabase/tests/000-setup.sql'],
      ['supabase-tests/001-rls-enabled.sql', 'supabase/tests/001-rls-enabled.sql'],
      ['supabase-tests/table-rls.test.sql.template', 'supabase/tests/table-rls.test.sql.template'],
      ['supabase-tests/README.md', 'supabase/tests/README.md'],
      ['SECURITY_NOTES.md', 'SECURITY_NOTES.md'],
    ],
  },
  {
    needs: '@playwright/test',
    has: (cwd) => declaredDeps(cwd).has('@playwright/test'),
    files: [
      ['e2e/playwright.config.ts', 'playwright.config.ts'],
      ['e2e/app.context.md', 'tests/app.context.md'],
      ['e2e/smoke.spec.ts', 'tests/e2e/smoke.spec.ts'],
    ],
  },
  {
    needs: 'next and @sentry/nextjs',
    has: (cwd) => declaredDeps(cwd).has('next') && declaredDeps(cwd).has('@sentry/nextjs'),
    files: [
      ['observability/instrumentation.ts', 'instrumentation.ts'],
      ['observability/instrumentation-client.ts', 'instrumentation-client.ts'],
      ['observability/sentry.server.config.ts', 'sentry.server.config.ts'],
      ['observability/sentry.edge.config.ts', 'sentry.edge.config.ts'],
      ['observability/sentry-setup.md', 'docs/sentry-setup.md'],
    ],
  },
  { needs: '', has: () => true, files: [['github-workflow-smugan.yml', '.github/workflows/smugan.yml']] },
];

/** Repo layout first (packages/gate → repo/templates), packaged fallback. @param {string} pkgRoot */
function templatesDir(pkgRoot) {
  for (const candidate of [join(pkgRoot, '..', '..', 'templates'), join(pkgRoot, 'templates')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The personal layer must never reach git. @param {string} cwd @returns {string} report line */
function ignoreLocalConfig(cwd) {
  const file = join(cwd, '.gitignore');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const listed = current.split(/\r?\n/).some((line) => line.trim().replace(/^\//, '') === LOCAL_CONFIG_FILE);
  if (listed) return `= .gitignore (${LOCAL_CONFIG_FILE} already listed)`;
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  appendFileSync(file, `${separator}${LOCAL_CONFIG_FILE}\n`);
  return `+ .gitignore: ${LOCAL_CONFIG_FILE}`;
}

/**
 * @param {string} cwd project root
 * @param {string} pkgRoot the smugan package root (packages/gate)
 * @returns {string[]} report lines
 */
export function runInit(cwd, pkgRoot) {
  const lines = [];
  const configPath = join(cwd, 'smugan.config.json');
  const existing = CONFIG_FILES.find((name) => existsSync(join(cwd, name)));
  if (existing) {
    lines.push(`= ${existing} (exists, kept)`);
  } else {
    writeFileSync(configPath, JSON.stringify(TEMPLATE_CONFIG, null, 2) + '\n');
    lines.push('+ smugan.config.json');
  }
  lines.push(ignoreLocalConfig(cwd));

  const templates = templatesDir(pkgRoot);
  if (!templates) {
    lines.push('! templates directory not found — project scaffolding skipped');
    return lines;
  }
  for (const group of GROUPS) {
    if (!group.has(cwd)) {
      lines.push(`- ${group.files.map(([, to]) => to).join(', ')} (skipped: the project does not declare ${group.needs})`);
      continue;
    }
    for (const [from, to] of group.files) lines.push(...copy(templates, from, cwd, to));
  }
  return lines;
}

/** @param {string} templates @param {string} from @param {string} cwd @param {string} to @returns {string[]} */
function copy(templates, from, cwd, to) {
  const source = join(templates, from);
  const target = join(cwd, to);
  if (!existsSync(source)) return [];
  if (existsSync(target)) return [`= ${to} (exists, kept)`];
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return [`+ ${to}`];
}
