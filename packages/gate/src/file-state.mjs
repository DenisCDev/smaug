// @ts-check
import { mkdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/** @param {unknown} error @param {string} code */
export function hasCode(error, code) {
  return error instanceof Error && 'code' in error && error.code === code;
}

/**
 * Only short local transactions own this lock; never run project checks or
 * remote I/O inside it. A crashed owner is reported unavailable instead of
 * stealing a lock that may still belong to a live process.
 * @template T @param {string} marker @param {() => T} operation @returns {T}
 */
export function withFileLock(marker, operation) {
  const lock = marker + '.lock';
  const deadline = Date.now() + 1500;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      const contended = hasCode(error, 'EEXIST') || (process.platform === 'win32' && hasCode(error, 'EPERM'));
      if (!contended || Date.now() >= deadline) throw error;
      Atomics.wait(pause, 0, 0, 5);
    }
  }
  try {
    return operation();
  } finally {
    rmdirSync(lock);
  }
}

/** Publish a complete snapshot; callers serialize read/modify/write separately.
 * @param {string} file @param {unknown} value
 */
export function writeAtomicJson(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    const deadline = Date.now() + 250;
    for (;;) {
      try {
        renameSync(temp, file);
        break;
      } catch (error) {
        // Windows scanners/readers can briefly hold the destination open.
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].some((code) => hasCode(error, code)) || Date.now() >= deadline) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
  } finally {
    try {
      unlinkSync(temp);
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
  }
}
