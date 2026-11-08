/* Component names. componentName also runs in the page, serialised with toString(). */

/* The name in a React fiber's `type`: a function or class, or the object forwardRef and memo wrap one in. */
export function componentName(type) {
  if (!type || typeof type === "string") return null;
  if (type.displayName) return type.displayName;
  if (typeof type === "function") return type.name || null;
  if (type.render) return type.render.displayName || type.render.name || null;
  if (type.type) return componentName(type.type);
  return null;
}

/* Capitalised declarations in a source file: the only names worth showing, which leaves out minified and library ones. */
export function declaredComponents(source) {
  return new Set([...source.matchAll(/\b(?:function|const|class)\s+([A-Z][A-Za-z0-9]+)/g)].map((match) => match[1]));
}
