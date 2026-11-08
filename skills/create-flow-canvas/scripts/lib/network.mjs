/* What the browser may reach during a capture. The app under capture is free; from anywhere else only the GET of a
   stylesheet or font, which the snapshot needs to look right. */
export function networkDecision({ url, method, resourceType }, appOrigin) {
  if (url.startsWith("data:") || url.startsWith("blob:")) return "app";
  if (new URL(url).origin === appOrigin) return "app";
  return method === "GET" && (resourceType === "stylesheet" || resourceType === "font") ? "asset" : "block";
}
