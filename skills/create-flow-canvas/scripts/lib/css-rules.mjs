/* Deciding which captured CSS rules are in use. Both functions also run inside the page, serialised with toString():
   they may refer only to their arguments, to globals, and to each other. */

/* Rewrites a selector to ask "could this match the captured DOM, whatever the pointer and focus are doing?".
   Returns the selector to test, or null when the rule must be kept without testing. Only states an interaction can
   change are neutralised: a structural pseudo-class such as :last-child stays, because it decides real matches.
   The scan goes character by character since escaped class names (.hover\:x) and quoted attributes hold colons. */
export function selectorProbe(selector) {
  const STATES = new Set(["hover", "focus", "focus-visible", "focus-within", "active", "visited", "link", "any-link",
    "target", "checked", "indeterminate", "disabled", "enabled", "read-only", "read-write", "placeholder-shown",
    "valid", "invalid", "user-valid", "user-invalid", "autofill", "open", "closed", "popover-open", "modal",
    "fullscreen"]);
  const LEGACY_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);
  const ANYTHING = ":is(*)";
  const parens = []; /* one entry per open "(": true when it opens a :not() */
  let out = "";
  let i = 0;
  while (i < selector.length) {
    const c = selector[i];
    if (c === "\\") {
      out += selector.slice(i, i + 2);
      i += 2;
    } else if (c === '"' || c === "'") {
      let end = i + 1;
      while (end < selector.length && selector[end] !== c) end += selector[end] === "\\" ? 2 : 1;
      out += selector.slice(i, end + 1);
      i = end + 1;
    } else if (c === "(" || c === ")") {
      if (c === "(") parens.push(false);
      else parens.pop();
      out += c;
      i++;
    } else if (c === ":") {
      const isElement = selector[i + 1] === ":";
      let end = i + (isElement ? 2 : 1);
      while (end < selector.length && /[\w-]/.test(selector[end])) end++;
      const name = selector.slice(i + (isElement ? 2 : 1), end).toLowerCase();
      if (isElement || LEGACY_ELEMENTS.has(name)) {
        if (selector[end] === "(") {
          let depth = 0;
          do {
            if (selector[end] === "(") depth++;
            else if (selector[end] === ")") depth--;
            end++;
          } while (depth > 0 && end < selector.length);
        }
        out += ANYTHING;
      } else if (STATES.has(name)) {
        if (parens.includes(true)) return null;
        out += ANYTHING;
      } else {
        out += selector.slice(i, end);
        if (selector[end] === "(") {
          parens.push(name === "not");
          out += "(";
          end++;
        }
      }
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/* A CSSRuleList as plain data, marking which rules are in use. `matches(selector)` asks the document; a selector it
   cannot parse (another browser's prefix, say) is kept. Grouping rules are walked; other at-rules are kept whole.
   Each becomes { s: selector, t: text, u: in use }, { g: head, c: children } or { t: text, u: true }. */
export function walkRules(rules, matches) {
  const inUse = (selector) => {
    const probe = selectorProbe(selector);
    if (probe === null) return true;
    try {
      return !!matches(probe);
    } catch {
      return true;
    }
  };
  return Array.from(rules, (rule) => {
    if (rule.selectorText !== undefined) {
      return { s: rule.selectorText, t: rule.cssText, u: rule.cssRules?.length > 0 || inUse(rule.selectorText) };
    }
    if (rule.cssRules && /^@(media|supports|layer|container)\b/.test(rule.cssText)) {
      return { g: rule.cssText.slice(0, rule.cssText.indexOf("{")).trim(), c: walkRules(rule.cssRules, matches) };
    }
    return { t: rule.cssText, u: true };
  });
}
