// security/json-path-validator.js
// Validates JSON that may contain image file paths.
// - Ensures paths live under baseImgDir (defeats traversal & symlink escapes via resolveUnder)
// - Enforces allowedExtensions
// - Optionally verifies existence and that the file is actually an image (via sharp in fs-guard)
// - Writes back sanitized paths into a cloned JSON object
//   * Option A (default): absolute paths (POSIX) → keeps CONFIG_IMG_DIR prefix for downstream consumers
//   * Option B: relative paths (set outputStyle: 'relative' if you ever want that)
//
// Returns: { ok, errors, normalizedJson, checkedPaths }
//
// Usage (in your route):
//   const { ok, errors, normalizedJson } = await validateJsonPaths(req.body, {
//     baseImgDir: BASE_IMG_DIR,
//     allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
//     requireExistence: true,
//     contentSniff: true,
//     checkOnlyKeys: ['image','images','thumbnail','backgroundImage'], // optional
//     checkKeysRegex: [/image/i, /thumb/i, /background/i, /photo/i],    // optional
//     outputStyle: 'absolute', // ← default (Option A)
//   });

const path = require('path');
const {
  resolveUnder,           // must return { absReal, relPosix }
  hasAllowedExtension,
  ensureRegularFile,
  verifyIsImage,
} = require('./fs-guard');

// Polyfill for structuredClone if unavailable (Node >=17 has it)
const clone = (obj) => (typeof structuredClone === 'function'
  ? structuredClone(obj)
  : JSON.parse(JSON.stringify(obj))
);

/** Heuristic for strings that look like file paths (kept conservative). */
function isPathLikeString(s, allowedExtensions = []) {
  if (typeof s !== 'string') return false;
  if (s.length === 0 || s.length > 4096) return false;

  // URLs are path-like but will be rejected later by resolveUnder (kept here to flag for check)
  if (/^[a-zA-Z]+:\/\//.test(s)) return true;

  // Directory separators or ends with an allowed extension
  const hasSep = /[\\/]/.test(s);
  const endsWithAllowedExt = allowedExtensions.some(ext => s.toLowerCase().endsWith(ext.toLowerCase()));

  return hasSep || endsWithAllowedExt;
}

/** Walk JSON and yield candidate strings via heuristics or targeted key matching. */

function* walkJsonForCandidates(node, {
  allowedKeys,
  allowedPatterns,
  currentPath = [],
  allowedExts = []
} = {}) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      yield* walkJsonForCandidates(node[i], {
        allowedKeys,
        allowedPatterns,
        currentPath: currentPath.concat([`[${i}]`]),
        allowedExts
      });
    }
    return;
  }

  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const nextPath = currentPath.concat([`.${k}`]);
      const keyAllowed =
        (Array.isArray(allowedKeys) && allowedKeys.includes(k)) ||
        (Array.isArray(allowedPatterns) && allowedPatterns.some(rx => rx.test(k)));

      if (keyAllowed) {
        if (typeof v === 'string') {
          yield { jsonPath: nextPath.join(''), value: v };
        } else if (Array.isArray(v)) {
          // ✅ Use a normal loop so `yield` is in the generator’s own scope
          for (let i = 0; i < v.length; i++) {
            const entry = v[i];
            if (typeof entry === 'string') {
              yield { jsonPath: nextPath.join('') + `[${i}]`, value: entry };
            }
          }
        }
      }

      // Continue recursion to reach nested structures too
      yield* walkJsonForCandidates(v, {
        allowedKeys,
        allowedPatterns,
        currentPath: nextPath,
        allowedExts
      });
    }
  }
}


/** Set a value back into an object using a simple ".key[0].key" jsonPath form. */
function setByJsonPath(root, jsonPath, newVal) {
  const tokens = jsonPath.match(/(\.\w+|\[\d+\])/g) || [];
  if (tokens.length === 0) return;
  let ctx = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    ctx = t.startsWith('.') ? ctx[t.slice(1)] : ctx[Number(t.slice(1, -1))];
    if (ctx == null) return; // path no longer valid; ignore silently
  }
  const last = tokens[tokens.length - 1];
  if (last.startsWith('.')) ctx[last.slice(1)] = newVal;
  else ctx[Number(last.slice(1, -1))] = newVal;
}

/**
 * Validate all path-like strings found in a JSON object.
 *
 * Options:
 *  - baseImgDir (required): string absolute path to the allowed base directory
 *  - allowedExtensions: array of extensions (e.g., ['.jpg','.jpeg','.png'])
 *  - checkOnlyKeys: array of key names to treat as paths (restricts scan)
 *  - checkKeysRegex: array of RegExp for key names to treat as paths (restricts scan)
 *  - requireExistence: boolean, verify the files exist and are regular files
 *  - contentSniff: boolean, verify files are real images (sharp metadata)
 *  - outputStyle: 'absolute' | 'relative' (default 'absolute' per Option A)
 */
async function validateJsonPaths(jsonObj, {
  baseImgDir,
  allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'],
  checkOnlyKeys,
  checkKeysRegex,
  requireExistence = true,
  contentSniff = true,
  outputStyle = 'absolute', // Option A default
} = {}) {
  if (!baseImgDir || typeof baseImgDir !== 'string') {
    throw new Error('validateJsonPaths: baseImgDir is required');
  }

  const errors = [];
  const checkedPaths = [];
  const normalized = clone(jsonObj);
  const ALLOWED_EXTS = (allowedExtensions || []).map(e => e.toLowerCase());

  // Build candidate list
  const candidates = [];

  if (checkOnlyKeys || checkKeysRegex) {
    for (const hit of walkJsonForCandidates(jsonObj, {
      allowedKeys: checkOnlyKeys,
      allowedPatterns: checkKeysRegex,
      allowedExts: ALLOWED_EXTS,
    })) {
      candidates.push(hit);
    }
  } else {
    // Heuristic deep scan for path-like strings anywhere
    (function deepScan(node, cur = []) {
      if (Array.isArray(node)) {
        node.forEach((v, i) => deepScan(v, cur.concat([`[${i}]`])));
      } else if (node && typeof node === 'object') {
        Object.entries(node).forEach(([k, v]) => deepScan(v, cur.concat([`.${k}`])));
      } else if (typeof node === 'string' && isPathLikeString(node, ALLOWED_EXTS)) {
        candidates.push({ jsonPath: cur.join('') || '$', value: node });
      }
    })(jsonObj);
  }

  for (const c of candidates) {
    const original = c.value;
    try {
      // Resolve & contain (accepts relative or absolute that’s inside base)
      const { absReal, relPosix } = await resolveUnder(baseImgDir, original);

      // Enforce extension on the actual path
      if (!hasAllowedExtension(absReal, ALLOWED_EXTS)) {
        throw new Error(`Extension not allowed: ${path.extname(absReal)}`);
      }

      // Optional existence + content check
      if (requireExistence) {
        await ensureRegularFile(absReal);
        if (contentSniff) {
          await verifyIsImage(absReal);
        }
      }

      // Decide what to write back into JSON (Option A default = absolute)
      const out = outputStyle === 'absolute'
        ? absReal.split(path.sep).join('/') // POSIXify for JSON stability
        : relPosix;

      setByJsonPath(normalized, c.jsonPath, out);

      checkedPaths.push({
        jsonPath: c.jsonPath,
        original,
        normalized: out,
        resolvedAbs: absReal,
      });
    } catch (err) {
      errors.push({ jsonPath: c.jsonPath, value: original, error: err.message });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    normalizedJson: normalized,
    checkedPaths,
  };
}

module.exports = {
  validateJsonPaths,
  isPathLikeString,
};
