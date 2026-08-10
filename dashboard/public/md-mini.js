// Minimal, safe Markdown → HTML renderer for the Pact IDE's .md viewer (the Ouronet repo is
// doc-heavy). Classic script → window.mdRender, loaded before app.js; Node-tested by eval.
//
// Safety: every source line is HTML-escaped BEFORE any formatting, so no markup can inject tags.
// Inline code spans are split out first so `**`/`*` inside them aren't treated as emphasis. Link
// URLs are whitelisted to http(s)/relative/anchor/mailto — `javascript:` and friends are dropped.
(function (root) {
  "use strict";

  function esc(s) {
    return s.replace(/[&<>]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; });
  }

  // Inline formatting on an ALREADY-ESCAPED string: code spans, links, bold, italic.
  function inline(s) {
    return s.split(/(`[^`]+`)/g).map(function (p) {
      if (/^`[^`]+`$/.test(p)) return '<code class="md-code">' + p.slice(1, -1) + "</code>";
      p = p.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (m, txt, url) {
        url = url.trim();
        if (!/^(https?:\/\/|\/|#|mailto:)/i.test(url)) return txt;   // block javascript:, data:, etc.
        return '<a href="' + url.replace(/"/g, "%22") + '" target="_blank" rel="noopener">' + txt + "</a>";
      });
      p = p.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      p = p.replace(/__([^_]+)__/g, "<strong>$1</strong>");
      p = p.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
      p = p.replace(/(^|[^_A-Za-z0-9])_([^_]+)_/g, "$1<em>$2</em>");
      return p;
    }).join("");
  }

  function mdRender(src) {
    var lines = String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n");
    var out = [];
    var i = 0, n = lines.length;
    while (i < n) {
      var line = lines[i];
      if (/^```/.test(line)) {                                     // fenced code
        var buf = []; i++;
        while (i < n && !/^```/.test(lines[i])) { buf.push(esc(lines[i])); i++; }
        i++;                                                       // consume closing fence
        out.push('<pre class="md-pre"><code>' + buf.join("\n") + "</code></pre>");
        continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }                  // blank
      var h = line.match(/^(#{1,6})\s+(.*)$/);                     // heading
      if (h) { var lv = h[1].length; out.push("<h" + lv + ' class="md-h">' + inline(esc(h[2])) + "</h" + lv + ">"); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr class="md-hr">'); i++; continue; }  // hr
      if (/^\s*>\s?/.test(line)) {                                 // blockquote
        var bq = [];
        while (i < n && /^\s*>\s?/.test(lines[i])) { bq.push(inline(esc(lines[i].replace(/^\s*>\s?/, "")))); i++; }
        out.push('<blockquote class="md-bq">' + bq.join("<br>") + "</blockquote>"); continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {                             // unordered list
        var ul = [];
        while (i < n && /^\s*[-*+]\s+/.test(lines[i])) { ul.push("<li>" + inline(esc(lines[i].replace(/^\s*[-*+]\s+/, ""))) + "</li>"); i++; }
        out.push('<ul class="md-ul">' + ul.join("") + "</ul>"); continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {                            // ordered list
        var ol = [];
        while (i < n && /^\s*\d+\.\s+/.test(lines[i])) { ol.push("<li>" + inline(esc(lines[i].replace(/^\s*\d+\.\s+/, ""))) + "</li>"); i++; }
        out.push('<ol class="md-ol">' + ol.join("") + "</ol>"); continue;
      }
      var para = [];                                              // paragraph
      while (i < n && !/^\s*$/.test(lines[i]) && !/^```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) &&
             !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) && !/^\s*>\s?/.test(lines[i])) {
        para.push(inline(esc(lines[i]))); i++;
      }
      out.push('<p class="md-p">' + para.join("<br>") + "</p>");
    }
    return out.join("\n");
  }

  root.mdRender = mdRender;
})(typeof window !== "undefined" ? window : this);
