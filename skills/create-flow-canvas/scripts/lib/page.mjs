/* What runs inside the captured page. Everything here is sent as source text, so each function may use only its
   arguments, browser globals and the other functions listed in `pageExpression`. */
import { selectorProbe, walkRules } from "./css-rules.mjs";
import { componentName } from "./components.mjs";
import { fitsBudget } from "./budget.mjs";

/* Tags each component's first DOM node with data-flow-c. Reads React's private fields, so anything unexpected,
   a production build or another framework leaves the capture untagged and otherwise whole. */
function tagComponents(names) {
  const wanted = new Set(names);
  const firstHost = (fiber) => {
    for (let child = fiber.child; child; child = child.sibling) {
      if (typeof child.type === "string" && child.stateNode instanceof Element) return child.stateNode;
      const host = firstHost(child);
      if (host) return host;
    }
    return null;
  };
  try {
    const tags = new Map();
    const visited = new Set();
    let sawFiber = false;
    for (const element of document.querySelectorAll("body *")) {
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
      if (!key) continue;
      sawFiber = true;
      for (let fiber = element[key].return; fiber && !visited.has(fiber); fiber = fiber.return) {
        visited.add(fiber);
        const name = componentName(fiber.type);
        if (!name || !wanted.has(name)) continue;
        const host = firstHost(fiber);
        if (host) tags.set(host, (tags.get(host) || new Set()).add(name));
      }
    }
    tags.forEach((set, host) => host.setAttribute("data-flow-c", [...set].join(" ")));
    return { source: sawFiber ? "react-fiber" : "none", tagged: tags.size };
  } catch (error) {
    return { source: "none", tagged: 0, error: String(error.message).slice(0, 200) };
  }
}

function readSheets() {
  const matches = (selector) => document.querySelector(selector.trim() || "*");
  const inlineKey = (sheet) => {
    /* a sheet filled through insertRule has no text of its own, so its rules name it */
    const text = sheet.ownerNode?.textContent || [...sheet.cssRules].map((rule) => rule.cssText).join("");
    return "inline:" + [...text].reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) | 0, 7);
  };
  return [...document.styleSheets].flatMap((sheet) => {
    try {
      return [{ key: sheet.href || inlineKey(sheet), href: sheet.href || location.href, rules: walkRules(sheet.cssRules, matches) }];
    } catch {
      return sheet.href ? [{ key: sheet.href, href: sheet.href, raw: true }] : []; /* cross-origin: fetched at assembly */
    }
  });
}

/* Plain facts for suspectSignals, which decides what they mean. */
function signalFacts() {
  const CANDIDATES = '[class*="skeleton" i],[class*="shimmer" i],[class*="animate-pulse"],[class*="spin" i],[class*="loader" i],[class*="loading" i],[class*="toast" i],[data-slot*="skeleton" i],[data-sonner-toast],[role="alert"],[role="progressbar"],[aria-busy="true"]';
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
  };
  const body = document.body;
  const bodyText = body.innerText || "";
  return {
    candidates: [...document.querySelectorAll(CANDIDATES)].filter(visible).map((element) => ({
      cls: element.getAttribute("class") || "",
      role: element.getAttribute("role") || "",
      busy: element.getAttribute("aria-busy") === "true",
      slot: element.getAttribute("data-slot") || "",
      type: element.getAttribute("data-type") || "",
      toast: element.hasAttribute("data-sonner-toast"),
      text: (element.textContent || "").slice(0, 300),
    })),
    textLength: bodyText.trim().length,
    elementCount: body.querySelectorAll("*:not(script,style,link,noscript,template)").length,
    mediaCount: body.querySelectorAll("img,canvas,video").length,
    bodyText: bodyText.slice(0, 5000),
  };
}

async function capturePage({ names, budgets }) {
  const sheets = readSheets();
  const components = tagComponents(names);
  const facts = signalFacts();
  const dropped = [];
  const PLACEHOLDER = "#8884";
  let inlinedBytes = 0;
  const reserve = (bytes) => {
    if (!fitsBudget(bytes, inlinedBytes, budgets)) return false;
    inlinedBytes += bytes;
    return true;
  };
  const toDataUrl = (blob) => new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result);
    reader.onerror = fail;
    reader.readAsDataURL(blob);
  });

  /* canvases become images; a PNG too large for the budget gets one chance as a smaller lossy image */
  const liveCanvases = [...document.querySelectorAll("canvas")];
  const canvasImages = liveCanvases.map((canvas) => {
    try {
      for (const url of [canvas.toDataURL(), canvas.toDataURL("image/webp", 0.8)]) {
        if (reserve(url.length * 0.75)) return url;
      }
    } catch { /* a tainted canvas cannot be read */ }
    dropped.push("canvas");
    return null;
  });

  /* cloned before any await, so the live lists and the copy still line up one to one */
  const clone = document.body.cloneNode(true);
  const liveImages = [...document.querySelectorAll("img")];
  const clonedImages = [...clone.querySelectorAll("img")];
  [...clone.querySelectorAll("canvas")].forEach((copy, i) => {
    const image = document.createElement("img");
    if (canvasImages[i]) image.src = canvasImages[i];
    else image.style.background = PLACEHOLDER;
    image.style.cssText += liveCanvases[i].style.cssText;
    image.className = liveCanvases[i].className;
    image.width = liveCanvases[i].width;
    image.height = liveCanvases[i].height;
    if (copy.hasAttribute("data-flow-c")) image.setAttribute("data-flow-c", copy.getAttribute("data-flow-c"));
    copy.replaceWith(image);
  });
  const liveFields = [...document.querySelectorAll("input,textarea,select")];
  [...clone.querySelectorAll("input,textarea,select")].forEach((copy, i) => {
    const field = liveFields[i];
    if (field.tagName === "TEXTAREA") copy.textContent = field.value;
    else if (field.tagName === "SELECT") [...copy.options].forEach((option, o) => option.toggleAttribute("selected", field.options[o]?.selected));
    else if (field.type === "checkbox" || field.type === "radio") copy.toggleAttribute("checked", field.checked);
    else copy.setAttribute("value", field.value);
  });
  clone.querySelectorAll("script,noscript,link,style[data-next-hide-fouc],iframe,nextjs-portal,vite-error-overlay,#webpack-dev-server-client-overlay").forEach((node) => node.remove());
  clone.querySelectorAll("a[href]").forEach((link) => link.setAttribute("data-flow-href", link.getAttribute("href")));

  let inlinedImages = 0;
  for (const [i, image] of clonedImages.entries()) {
    const url = liveImages[i].currentSrc || liveImages[i].src;
    image.removeAttribute("srcset");
    image.removeAttribute("data-nimg");
    if (url.startsWith("data:")) continue;
    let data = null;
    if (url) {
      try {
        const blob = await (await fetch(url)).blob();
        if (reserve(blob.size)) data = await toDataUrl(blob);
        else dropped.push(url);
      } catch {
        dropped.push(url);
      }
    }
    if (data) {
      image.src = data;
      inlinedImages++;
    } else {
      image.removeAttribute("src");
      image.style.background = PLACEHOLDER;
    }
  }

  const style = getComputedStyle(document.body);
  return {
    html: clone.innerHTML,
    rootCls: document.documentElement.className,
    bodyCls: document.body.className,
    bg: style.backgroundColor,
    color: style.color,
    font: style.fontFamily,
    fs: style.fontSize,
    sheets,
    families: [...new Set([...document.querySelectorAll("*")].flatMap((element) => getComputedStyle(element).fontFamily.split(",").map((name) => name.trim().replace(/['"]/g, ""))))],
    links: [...document.querySelectorAll("a[href]")].map((link) => ({ href: link.getAttribute("href"), text: (link.innerText || link.getAttribute("aria-label") || "").trim().slice(0, 40) })),
    scrollH: document.documentElement.scrollHeight,
    title: document.title,
    components,
    inlined: { images: inlinedImages, canvases: canvasImages.filter(Boolean).length, bytes: Math.round(inlinedBytes), dropped },
    facts,
  };
}

/* Takes the framework's dev overlay out of the page, saying whether it was showing an error. */
function clearDevOverlays() {
  const portal = document.querySelector("nextjs-portal");
  const showingError = !!portal?.shadowRoot?.querySelector("[data-nextjs-dialog]")
    || !!document.querySelector("vite-error-overlay,#webpack-dev-server-client-overlay");
  document.querySelectorAll("nextjs-portal,vite-error-overlay,#webpack-dev-server-client-overlay").forEach((node) => node.remove());
  return showingError;
}

/* The source text for page.evaluate: the helpers, then a call to capturePage. */
export function pageExpression(options) {
  const helpers = [selectorProbe, walkRules, componentName, fitsBudget, tagComponents, readSheets, signalFacts, capturePage];
  return `(() => { ${helpers.join("\n")}\n return capturePage(${JSON.stringify(options)}); })()`;
}

export const clearOverlaysExpression = `(${clearDevOverlays})()`;
