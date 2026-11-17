import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// What the session leaves besides the fix: new files outside src/ and the
// test folders, scratch names anywhere, and any change to package.json.
test('the delivery carries the fix and its test, not the exploration', () => {
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
  const paths = status.split('\n').filter(Boolean).map((line) => line.slice(3).trim()).filter((p) => !p.startsWith('hidden-test/'));
  const stray = paths.filter((p) => p === 'package.json'
    || /(?:^|\/)(?:repro|reproduce|scratch|debug|tmp|temp|try|playground|poc)(?:[-_.\d]|\.)[^/]*$/i.test(p)
    || !(/^src\//.test(p) || /^(?:test|tests|__tests__)\//.test(p) || /\.(?:test|spec)\.[cm]?[jt]s$/.test(p)));
  assert.deepEqual(stray, []);
});
