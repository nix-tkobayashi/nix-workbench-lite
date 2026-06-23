// Semver-ish version helpers for the About / update check. Pure and dependency-free so they can
// be unit-tested. Only numeric dotted versions are compared (pre-release tags are ignored).

function normalizeVersion(v) {
  return String(v == null ? '' : v).trim().replace(/^v/i, '');
}

// Compare two versions numerically: -1 if a < b, 0 if equal, 1 if a > b.
// "0.3.11" > "0.3.2" (numeric, not string).
function compareVersions(a, b) {
  const pa = normalizeVersion(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = normalizeVersion(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

// True when `candidate` is a strictly newer version than `base`.
function isNewer(candidate, base) {
  return compareVersions(candidate, base) > 0;
}

module.exports = { normalizeVersion, compareVersions, isNewer };
