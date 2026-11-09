/* Finding and launching Playwright. It is not a dependency of this skill, so it comes from wherever the machine has it. */
import { execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = ["playwright", "playwright-core", "@playwright/test"];
const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function globalRoot() {
  try {
    return execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/* FLOW_PLAYWRIGHT wins, then the roots in order, each resolved as Node would from a file inside it. */
export function loadPlaywright({ env = process.env, roots, cwd = process.cwd() } = {}) {
  const require = createRequire(import.meta.url);
  if (env.FLOW_PLAYWRIGHT) {
    try {
      return require(env.FLOW_PLAYWRIGHT);
    } catch (error) {
      throw new Error(`FLOW_PLAYWRIGHT=${env.FLOW_PLAYWRIGHT} could not be loaded: ${error.message}`);
    }
  }
  /* a shell does not keep FLOW_PLAYWRIGHT from one command to the next, so the project can keep the path */
  const saved = path.join(cwd, ".flow-canvas", "playwright-path");
  if (fs.existsSync(saved)) {
    const target = fs.readFileSync(saved, "utf8").trim();
    try {
      return require(target);
    } catch (error) {
      throw new Error(`${saved} points at ${target}, which could not be loaded: ${error.message}`);
    }
  }
  const global = roots ? null : globalRoot();
  const searched = roots ?? [cwd, SKILL_ROOT, global].filter(Boolean);
  for (const root of searched) {
    const fromRoot = createRequire(path.join(root, "x", "noop.js")); /* so a global node_modules folder is searched too */
    for (const name of PACKAGES) {
      try {
        return fromRoot(name);
      } catch (error) {
        if (error.code !== "MODULE_NOT_FOUND") throw error;
      }
    }
  }
  throw new Error(
    `Playwright was not found (looked for ${PACKAGES.join(", ")} from ${searched.join(", ")}).\n` +
      "Install it in the throwaway copy, never in the source project (npm i --no-save playwright), " +
      "or point FLOW_PLAYWRIGHT at an installed playwright or playwright-core folder.",
  );
}

/* The machine's Chrome first, so no browser download is needed; Playwright's own Chromium otherwise. */
export async function launchBrowser({ chromium }) {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (chromeError) {
    try {
      return await chromium.launch({ headless: true });
    } catch (bundledError) {
      throw new Error(`No browser could start.\nChrome: ${chromeError.message}\nChromium: ${bundledError.message}\nInstall Chrome, or run: npx playwright install chromium`);
    }
  }
}
