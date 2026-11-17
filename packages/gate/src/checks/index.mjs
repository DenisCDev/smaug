// @ts-check
/**
 * @typedef {{ line: number, message: string }} Finding
 * @typedef {{ path: string, content: string, lines: string[],
 *   config: import('../config.mjs').SmuganConfig, options: Record<string, any> }} CheckContext
 * @typedef {{ name: string, appliesTo: (path: string) => boolean,
 *   run: (ctx: CheckContext) => Finding[] }} Check
 */
import dbNaming from './db-naming.mjs';
import rls from './rls.mjs';
import rlsTests from './rls-tests.mjs';
import securityNotes from './security-notes.mjs';
import uiStrings from './ui-strings.mjs';
import noAny from './no-any.mjs';
import secrets from './secrets.mjs';
import consoleLog from './console-log.mjs';
import deadImports from './dead-imports.mjs';
import staleMutation from './stale-mutation.mjs';
import testWeakening from './test-weakening.mjs';
import moneyFloat from './money-float.mjs';
import emptyCatch from './empty-catch.mjs';
import anonGrants from './anon-grants.mjs';
import fetchTimeout from './fetch-timeout.mjs';
import viewInvoker from './view-invoker.mjs';
import searchPath from './search-path.mjs';
import rlsPolicy from './rls-policy.mjs';

/** @type {Check[]} */
export const CHECKS = [dbNaming, rls, rlsTests, securityNotes, uiStrings, noAny, secrets, consoleLog, deadImports, staleMutation, testWeakening, moneyFloat, emptyCatch, anonGrants, fetchTimeout, viewInvoker, searchPath, rlsPolicy];
