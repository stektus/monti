// Translation, in the smallest shape that still reads correctly in a
// language with cases and three plural forms.
//
// The key is the English sentence itself. Static markup therefore needs no
// data-i18n attributes on 180 elements, and a phrase nobody translated yet
// shows up in English instead of as a bare key like "settings.cache.title".
// The exception is a sentence broken up by a link or a <b>: word order moves
// that link elsewhere in another language, so those carry an explicit
// data-i18n key and are translated whole, markup included.
//
// Dictionaries are ES modules rather than JSON files only because the app
// loads its frontend as plain modules with no bundler and no fetch at start;
// the contents are a flat object of "English": "translation" either way.

import uk from "./locales/uk.js";
import ru from "./locales/ru.js";

const DICTS = { uk, ru };

// Shown in the language picker, each in its own language — a person looking
// for their language does not read the English name of it.
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "uk", label: "Українська" },
  { code: "ru", label: "Русский" },
];

const LANG_KEY = "monti.lang";

function initialLang() {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved && (saved === "en" || DICTS[saved])) return saved;
  // navigator.language is the desktop's locale; "uk-UA" and "uk" both mean uk.
  const sys = (navigator.language || "en").toLowerCase().split("-")[0];
  return DICTS[sys] ? sys : "en";
}

let lang = initialLang();
const listeners = new Set();

export const getLang = () => lang;

export function setLang(next) {
  if (next === lang) return;
  lang = next === "en" || DICTS[next] ? next : "en";
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
  applyDom();
  for (const fn of listeners) fn();
}

// Called after a language change so the parts drawn from JavaScript — drive
// cards, transfers, dialogs already filled in — are drawn again.
export const onLangChange = (fn) => listeners.add(fn);

function plural(forms, n) {
  const rule = new Intl.PluralRules(lang).select(Number(n) || 0);
  return forms[rule] ?? forms.other ?? forms.one ?? "";
}

const fill = (s, params) =>
  params
    ? s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m))
    : s;

// The translation of `key`, or `key` itself when there is none. `params`
// fills {placeholders}; `params.n` also picks the plural form.
export function t(key, params) {
  let value = DICTS[lang]?.[key];
  if (value && typeof value === "object") value = plural(value, params?.n);
  return fill(typeof value === "string" && value ? value : key, params);
}

// ---------- numbers ----------

const num = (n, digits = 0) =>
  new Intl.NumberFormat(lang, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);

// Units are translated like anything else: a Ukrainian reader expects ГБ.
export const fmtBytes = (n) =>
  n >= 1073741824
    ? `${num(n / 1073741824, 1)} ${t("GB")}`
    : n >= 1048576
      ? `${num(Math.round(n / 1048576))} ${t("MB")}`
      : `${num(Math.max(1, Math.round(n / 1024)))} ${t("kB")}`;

export const fmtSpeed = (bps) =>
  bps >= 1048576
    ? `${num(bps / 1048576, 1)} ${t("MB/s")}`
    : bps >= 1024
      ? `${num(Math.round(bps / 1024))} ${t("kB/s")}`
      : `${num(Math.round(bps))} ${t("B/s")}`;

export const fmtNumber = (n) => num(n);

// ---------- static markup ----------

// The English original of everything translated in place, so switching
// language a second time translates from English again instead of from the
// language before it.
const originalText = new Map(); // text node -> string
const originalAttr = new Map(); // element -> { attr: string }
const originalHtml = new Map(); // element -> string
let collected = false;

const ATTRS = ["placeholder", "title", "aria-label"];
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

function collect() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    originalHtml.set(el, el.innerHTML);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP.has(parent.tagName) || parent.closest("svg, [data-i18n]")) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    originalText.set(node, node.textContent);
  }
  for (const el of document.querySelectorAll("[placeholder], [title], [aria-label]")) {
    const saved = {};
    for (const a of ATTRS) {
      if (el.hasAttribute(a)) saved[a] = el.getAttribute(a);
    }
    originalAttr.set(el, saved);
  }
  collected = true;
}

// Translate the markup that came with the page. Safe to call again: every
// pass starts from the English original.
export function applyDom() {
  if (!collected) collect();

  for (const [el, html] of originalHtml) {
    const key = el.getAttribute("data-i18n");
    const translated = DICTS[lang]?.[key];
    el.innerHTML = typeof translated === "string" && translated ? translated : html;
  }

  for (const [node, original] of originalText) {
    // Keep the surrounding whitespace: a text node can be " and " between
    // two inline elements, and trimming it would glue the words together.
    const [, before, body, after] = original.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const translated = DICTS[lang]?.[body.replace(/\s+/g, " ")];
    node.textContent =
      typeof translated === "string" && translated
        ? before + translated + after
        : original;
  }

  for (const [el, saved] of originalAttr) {
    for (const [attr, original] of Object.entries(saved)) {
      const translated = DICTS[lang]?.[original];
      el.setAttribute(attr, typeof translated === "string" && translated ? translated : original);
    }
  }

  document.documentElement.lang = lang;
}
