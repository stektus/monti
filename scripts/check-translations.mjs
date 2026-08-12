#!/usr/bin/env node
// Checks the translations against the code that uses them.
//
// A wrong translation file fails quietly: the phrase shows in English and
// nobody notices for a release or two. This finds the three ways it happens —
// a phrase nobody translated, a {placeholder} lost in translation, and a
// counted phrase missing one of the plural forms its language needs.
//
//     node scripts/check-translations.mjs
//
// Run from the repository root. Exits non-zero with a list when something is
// off, which is what CI looks at.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Provider names, protocols and sample paths: people look for these exactly
// as their provider writes them, so they stay English on purpose.
const KEEP_ENGLISH = new Set([
  "Monti", "GitHub", "Google Drive", "Dropbox", "OneDrive", "Box", "pCloud",
  "Yandex Disk", "WebDAV", "S3", "SFTP", "Nextcloud", "ownCloud", "Amazon S3",
  "Backblaze B2", "MEGA", "Proton Drive",
  "Cloudflare R2", "MinIO", "Client ID", "Client secret", "rclone",
  "https://cloud.example.com/remote.php/webdav/", "https://…",
  "server.example.com", "~/.ssh/id_ed25519", "~/CloudDrives/…",
  "Documents", "~/Documents",
]);

// ---------- keys the page asks for ----------

// The markup carries its own English, so a key is the sentence itself. An
// element with data-i18n is translated whole, markup included, and its key is
// the attribute — sentences broken up by a link move that link elsewhere in
// another language.
// The key has to be what the browser will hand to t(): entities resolved and
// runs of whitespace collapsed, the same way applyDom() does it. &nbsp; is a
// whitespace character to a JavaScript \s, so "+&nbsp; New sync" in the file
// is "+ New sync" in the DOM.
const ENTITIES = { nbsp: "\u00a0", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const normalize = (text) =>
  text
    .replace(/&(#?\w+);/g, (m, name) => ENTITIES[name] ?? m)
    .replace(/\s+/g, " ")
    .trim();

function keysFromHtml(html) {
  const keys = [];
  let rest = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, "");

  let skipDepth = 0; // >0 while inside a data-i18n element
  const tag = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let last = 0;
  let m;
  while ((m = tag.exec(rest))) {
    const text = rest.slice(last, m.index);
    last = tag.lastIndex;
    if (!skipDepth) {
      const clean = normalize(text);
      if (clean && /[A-Za-z]{2}/.test(clean)) keys.push(clean);
    }
    const [, closing, , attrs, selfClosing] = m;
    if (closing) {
      if (skipDepth) skipDepth--;
      continue;
    }
    const isVoid = selfClosing || /^(br|hr|img|input|meta|link|source)$/i.test(m[2]);
    const i18n = /\bdata-i18n\s*=\s*"([^"]*)"/.exec(attrs);
    if (!skipDepth) {
      for (const a of ["placeholder", "title", "aria-label"]) {
        const v = new RegExp(`\\b${a}\\s*=\\s*"([^"]*)"`).exec(attrs);
        if (v && /[A-Za-z]{2}/.test(v[1])) keys.push(normalize(v[1]));
      }
    }
    if (i18n) {
      keys.push(i18n[1]);
      if (!isVoid) skipDepth = 1;
    } else if (skipDepth && !isVoid) {
      skipDepth++;
    }
  }
  return keys;
}

// Every t("…") in the interface. The first argument is read and evaluated
// when it is only string literals and +, which is all the code uses.
function keysFromJs(src) {
  const keys = [];
  const unresolved = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "t" || src[i + 1] !== "(") continue;
    if (/[A-Za-z0-9_$.]/.test(src[i - 1] || "")) continue;
    if (src.slice(Math.max(0, i - 9), i) === "function ") continue; // the definition
    let depth = 0;
    let quote = null;
    let j = i + 1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === "\\") j++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
    }
    const args = src.slice(i + 2, j);
    let d = 0;
    let q = null;
    let cut = args.length;
    for (let k = 0; k < args.length; k++) {
      const c = args[k];
      if (q) {
        if (c === "\\") k++;
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if ("([{".includes(c)) d++;
      else if (")]}".includes(c)) d--;
      else if (c === "," && d === 0) {
        cut = k;
        break;
      }
    }
    const expr = args.slice(0, cut).trim();
    if (!/^["'`]/.test(expr)) {
      unresolved.push(expr.slice(0, 60));
      continue;
    }
    try {
      keys.push(Function(`"use strict"; return (${expr});`)());
    } catch {
      unresolved.push(expr.slice(0, 60));
    }
  }
  return { keys, unresolved };
}

// Phrases the code looks up through a table rather than writing out, so no
// scan can find them. Keep this in step with PROVIDER_LABELS, SCHEDULE_LABELS
// and the setEngine() calls in src/main.js.
const TABLE_KEYS = [
  "engine not installed", "engine running", "engine failed", "engine stopped",
  "starting…", "restarting…",
  "Google Drive", "Dropbox", "OneDrive", "Box", "pCloud", "Yandex Disk",
  "WebDAV", "S3", "SFTP", "Backblaze B2", "MEGA", "Proton Drive", "encrypted",
  "manual", "when Monti starts", "every 15 minutes", "every hour",
];

// ---------- the check ----------

const html = readFileSync(join(root, "src/index.html"), "utf8");
const js =
  readFileSync(join(root, "src/main.js"), "utf8") +
  "\n" +
  readFileSync(join(root, "src/i18n.js"), "utf8");
const { keys: jsKeys, unresolved } = keysFromJs(js);
const wanted = [...new Set([...keysFromHtml(html), ...jsKeys, ...TABLE_KEYS])];

const locales = readdirSync(join(root, "src/locales"))
  .filter((f) => f.endsWith(".js"))
  .map((f) => f.replace(/\.js$/, ""));

let failed = false;
const fail = (line) => {
  failed = true;
  console.log(line);
};

for (const code of locales) {
  const dict = (await import(join(root, "src/locales", `${code}.js`))).default;
  const known = Object.keys(dict);

  const missing = wanted.filter((k) => !(k in dict) && !KEEP_ENGLISH.has(k));
  // A key nobody asks for is a translation that will never be shown — nearly
  // always a typo in the key, which is exactly what needs to be caught.
  const orphan = known.filter((k) => !wanted.includes(k) && !KEEP_ENGLISH.has(k));

  console.log(
    `${code}: ${wanted.length - missing.length} of ${wanted.length} phrases`
  );
  for (const k of missing) fail(`  ${code}: no translation for ${JSON.stringify(k)}`);
  for (const k of orphan) fail(`  ${code}: nothing asks for ${JSON.stringify(k)}`);

  const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  for (const [key, value] of Object.entries(dict)) {
    const want = new Set([...key.matchAll(/\{(\w+)\}/g)].map((x) => x[1]));
    for (const text of typeof value === "string" ? [value] : Object.values(value)) {
      const got = new Set([...text.matchAll(/\{(\w+)\}/g)].map((x) => x[1]));
      const lost = [...want].filter((x) => !got.has(x));
      const extra = [...got].filter((x) => !want.has(x));
      if (lost.length) fail(`  ${code}: ${JSON.stringify(key)} loses {${lost}}`);
      if (extra.length) fail(`  ${code}: ${JSON.stringify(key)} invents {${extra}}`);
    }
    if (typeof value !== "string") {
      const absent = forms.filter((f) => !(f in value));
      if (absent.length) {
        fail(`  ${code}: ${JSON.stringify(key)} has no ${absent} form`);
      }
    }
  }
}

if (unresolved.length) {
  console.log(`\n${unresolved.length} t() calls take a variable, checked by hand:`);
  for (const u of unresolved) console.log(`  ${u}`);
}

console.log(failed ? "\ntranslations need fixing" : "\ntranslations check out");
process.exit(failed ? 1 : 0);
