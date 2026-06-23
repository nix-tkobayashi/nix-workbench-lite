const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVersion, compareVersions, isNewer } = require('../src/version');

test('normalizeVersion strips a leading v and trims', () => {
  assert.equal(normalizeVersion('v0.4.0'), '0.4.0');
  assert.equal(normalizeVersion(' 0.3.11 '), '0.3.11');
  assert.equal(normalizeVersion('V1.2.3'), '1.2.3');
  assert.equal(normalizeVersion(undefined), '');
});

test('compareVersions compares numerically, not lexically', () => {
  assert.equal(compareVersions('0.3.11', '0.3.2'), 1); // 11 > 2
  assert.equal(compareVersions('0.3.2', '0.3.11'), -1);
  assert.equal(compareVersions('0.4.0', '0.3.11'), 1);
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.4.0', '0.4.0'), 0);
  assert.equal(compareVersions('v0.4.0', '0.4.0'), 0); // leading v ignored
});

test('compareVersions tolerates differing segment counts', () => {
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.1', '1.2'), 1);
});

test('isNewer is strict greater-than', () => {
  assert.equal(isNewer('0.4.0', '0.3.11'), true);
  assert.equal(isNewer('0.3.11', '0.4.0'), false);
  assert.equal(isNewer('0.4.0', '0.4.0'), false);
  assert.equal(isNewer('v0.5.0', '0.4.9'), true);
});
