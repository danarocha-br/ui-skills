/* The engine's devices and screen document, for scripts that run outside it. A test holds these to assets/flow-canvas.html. */
export const DEVICES = {
  mobile: { width: 390, height: 844, cls: "dm" },
  tablet: { width: 768, height: 1024, cls: "dw dt" },
  desktop: { width: 1200, height: 772, cls: "dw dd" },
};

export const screenDocument = (body, css, icons, cls) => `<!doctype html><html><head><meta charset="utf-8">
<style>html{width:100%;height:100%;margin:0;overflow:hidden;overscroll-behavior:none}
body{width:100%;height:100%;margin:0;position:relative;display:flex;flex-direction:column;font-size:12px;overflow:auto;overscroll-behavior:contain}</style>
<style>${css}</style></head><body class="phone ${cls}"><svg width="0" height="0" style="position:absolute" aria-hidden="true">${icons}</svg>${body}</body></html>`;
