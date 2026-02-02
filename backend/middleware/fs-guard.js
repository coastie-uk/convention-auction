
// security/fs-guard.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const sharp = require('sharp');

function isUrlLike(s) {
  return /^[a-zA-Z]+:\/\//.test(s);
}

/**
 * Resolve a candidate path under a base dir, allowing either relative or absolute.
 * Returns { absReal, relPosix } where:
 *  - absReal: OS-absolute realpath
 *  - relPosix: POSIX-style relative path from base (safe to store in JSON)
 */
async function resolveUnder(baseDir, candidatePath) {
  if (typeof candidatePath !== 'string') throw new Error('Path must be a string');
  if (candidatePath.includes('\0')) throw new Error('NUL byte in path');
  if (isUrlLike(candidatePath)) throw new Error('Absolute paths and URLs are not allowed');

  const baseReal = await fsp.realpath(baseDir);

  // Normalise slashes early (allow Windows-style input)
  const normalizedInput = candidatePath.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  const isAbs = path.isAbsolute(normalizedInput);

  // Compute the would-be absolute path
  const absIntended = isAbs
    ? normalizedInput
    : path.join(baseReal, normalizedInput.split('/').join(path.sep));

  // Resolve real path (or parent if missing file)
  const absReal = await fsp.realpath(absIntended).catch(async (e) => {
    if (e && e.code === 'ENOENT') {
      const parentReal = await fsp.realpath(path.dirname(absIntended));
      if (parentReal !== baseReal && !parentReal.startsWith(baseReal + path.sep)) {
        throw new Error('Parent directory escapes base');
      }
      // File may not exist yet; still enforce containment via parent
      return absIntended;
    }
    throw e;
  });

  // Containment check
  if (absReal !== baseReal && !absReal.startsWith(baseReal + path.sep)) {
    throw new Error('Resolved path escapes base directory');
  }

  // Compute POSIX-style relative path for storage
  const rel = path.relative(baseReal, absReal);
  const relPosix = rel.split(path.sep).join('/'); // normalize for JSON

  return { absReal, relPosix };
}

function hasAllowedExtension(filePath, allowedExtensions) {
  const ext = path.extname(filePath).toLowerCase();
  return allowedExtensions.map(e => e.toLowerCase()).includes(ext);
}

async function ensureRegularFile(absPath) {
  const st = await fsp.stat(absPath);
  if (!st.isFile()) throw new Error('Not a regular file');
}

async function verifyIsImage(absPath) {
  await sharp(absPath).metadata();
}

module.exports = {
  resolveUnder,
  hasAllowedExtension,
  ensureRegularFile,
  verifyIsImage,
};
