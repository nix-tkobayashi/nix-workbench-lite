// Minimal, dependency-free Markdown -> HTML renderer for the file viewer's preview. Intentionally
// small (headings, emphasis, code, lists, quotes, rules, links, images, paragraphs) — not a full
// CommonMark implementation. Safety first: everything is HTML-escaped, only a controlled set of tags
// is emitted, and link/image URLs are scheme-checked so `javascript:`/`data:` can't inject script.
// IIFE so nothing leaks to the renderer globals (see i18n.js); dual-exported for require() in tests.
(function () {
  // Private-use sentinels bracket extracted code-span indices. escapeHtml leaves them intact and real
  // content never contains them, so restoring later can't collide with ordinary text (e.g. " 5 ").
  const CS_OPEN = String.fromCharCode(0xE000);
  const CS_CLOSE = String.fromCharCode(0xE001);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // Only http(s) links become real anchors. Anything else (relative, mailto, javascript:, data:, …)
  // renders as plain text — so there's no <a> a middle-click/window-open could follow to bypass the
  // renderer's click handler, which only routes http(s) to the OS browser. URLs here are HTML-escaped.
  function safeLinkUrl(url) {
    const u = url.trim();
    return /^https?:\/\//i.test(u) ? u : null;
  }

  function linkTag(text, url) {
    const safe = safeLinkUrl(url);
    return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
  }

  function imgTag(alt, url) {
    const u = url.trim();
    // Only remote or data:image sources render; anything else (e.g. a local WSL path a <img> can't
    // load) falls back to the alt text.
    return /^(https?:|data:image\/)/i.test(u) ? `<img src="${u}" alt="${alt}">` : alt;
  }

  // Inline spans within a single block of text. Code spans are pulled out before escaping so their
  // contents are shown verbatim and never re-interpreted as markup, then restored last.
  function inline(text) {
    const codes = [];
    let s = String(text).replace(/`([^`]+)`/g, (_m, c) => { codes.push(c); return CS_OPEN + (codes.length - 1) + CS_CLOSE; });
    s = escapeHtml(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => imgTag(alt, url));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, txt, url) => linkTag(txt, url));
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/_([^_]+)_/g, '<em>$1</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(new RegExp(CS_OPEN + '(\\d+)' + CS_CLOSE, 'g'), (_m, i) => `<code>${escapeHtml(codes[+i])}</code>`);
    return s;
  }

  const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;

  function render(src) {
    const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      const fence = line.match(/^(```|~~~)(.*)$/);
      if (fence) {
        const marker = fence[1];
        const lang = fence[2].trim().split(/\s+/)[0];
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].startsWith(marker)) { buf.push(lines[i]); i++; }
        if (i < lines.length) i++; // consume the closing fence
        const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        out.push(`<pre><code${cls}>${escapeHtml(buf.join('\n'))}</code></pre>`);
        continue;
      }

      if (/^\s*$/.test(line)) { i++; continue; }

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { out.push(`<h${h[1].length}>${inline(h[2].replace(/\s+#+\s*$/, '').trim())}</h${h[1].length}>`); i++; continue; }

      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`);
        continue;
      }

      if (LIST_ITEM.test(line)) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const items = [];
        while (i < lines.length && LIST_ITEM.test(lines[i])) { items.push(lines[i].replace(LIST_ITEM, '')); i++; }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
        continue;
      }

      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(```|~~~)/.test(lines[i]) &&
             !/^#{1,6}\s+/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !LIST_ITEM.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }
    return out.join('\n');
  }

  const markdown = { render };
  if (typeof module !== 'undefined' && module.exports) module.exports = markdown;
  if (typeof window !== 'undefined') window.markdown = markdown;
})();
