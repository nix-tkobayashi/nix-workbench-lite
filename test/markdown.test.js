const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/markdown');

test('renders headings and inline emphasis/code', () => {
  assert.equal(render('# Title'), '<h1>Title</h1>');
  assert.ok(render('**bold**').includes('<strong>bold</strong>'));
  assert.ok(render('*it*').includes('<em>it</em>'));
  assert.ok(render('`x=1`').includes('<code>x=1</code>'));
});

test('escapes HTML so raw tags cannot inject markup', () => {
  const out = render('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'), 'script tag must be escaped');
  assert.ok(out.includes('&lt;script&gt;'));
});

test('code spans/blocks are shown verbatim and escaped', () => {
  assert.ok(render('`<b>`').includes('<code>&lt;b&gt;</code>'));
  const block = render('```\n<x> a & b\n```');
  assert.ok(block.startsWith('<pre><code>'));
  assert.ok(block.includes('&lt;x&gt; a &amp; b'));
});

test('a number surrounded by spaces is not mistaken for a code-span placeholder', () => {
  assert.equal(render('in 5 out'), '<p>in 5 out</p>');
});

test('links: safe URLs become anchors, javascript: is neutralized', () => {
  assert.ok(render('[go](https://a.com)').includes('<a href="https://a.com"'));
  const js = render('[x](javascript:alert)');
  assert.ok(!js.includes('href'), 'javascript: URL must not produce an href');
  assert.ok(!js.includes('<a '), 'javascript: URL must not produce an anchor');
  assert.equal(js, '<p>x</p>');
});

test('images: only http/data:image render, local paths fall back to alt', () => {
  assert.ok(render('![a](https://a.com/x.png)').includes('<img src="https://a.com/x.png"'));
  assert.equal(render('![alt](./local.png)'), '<p>alt</p>');
});

test('lists group consecutive items', () => {
  assert.equal(render('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(render('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
});

test('blockquote and horizontal rule', () => {
  assert.ok(render('> quoted').includes('<blockquote>'));
  assert.equal(render('---'), '<hr>');
});
