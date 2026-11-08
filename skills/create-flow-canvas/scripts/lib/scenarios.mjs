/* The project-owned `.flow-canvas/scenarios.json`: which screens to capture, in which states. Nothing about any one
   project lives in the capture script; it all comes through here. */
import { DEVICES } from "./devices.mjs";

export const slug = (name) => name.replace(/\W/g, "_");

const STEP_ACTIONS = ["click", "hover", "fill", "press", "wait", "waitFor"];

function stepProblem(step) {
  const action = step && typeof step === "object" && STEP_ACTIONS.find((name) => name in step);
  if (!action) return `must be one of ${STEP_ACTIONS.join(", ")}`;
  if (action === "wait") return Number.isFinite(step.wait) ? null : "wait needs a number of milliseconds";
  if (typeof step[action] !== "string" || !step[action]) return `${action} needs a selector or key`;
  if (action === "fill" && typeof step.value !== "string") return "fill needs a string value";
  return null;
}

/* Returns the file with its cookie names defaulted, or throws naming every problem so one edit can fix them all. */
export function readScenarios(file) {
  const problems = [];
  const seen = new Set();
  if (!Array.isArray(file?.screens) || file.screens.length === 0) throw new Error("scenarios: `screens` must be a non-empty list");
  for (const [i, screen] of file.screens.entries()) {
    const name = screen.id ?? `#${i + 1}`;
    if (typeof screen.id !== "string" || !/^[\w-]+$/.test(screen.id)) problems.push(`screen ${name}: id must be letters, digits, _ or -`);
    if (seen.has(screen.id)) problems.push(`screen ${name}: id is used more than once`);
    seen.add(screen.id);
    if (typeof screen.url !== "string" || !screen.url.startsWith("/") || screen.url.startsWith("//")) problems.push(`screen ${name}: url must be a path starting with /`);
    if (typeof screen.route !== "string") problems.push(`screen ${name}: route is required`);
    if (!Array.isArray(screen.states) || screen.states.length === 0) {
      problems.push(`screen ${name}: needs at least one state`);
      continue;
    }
    const files = new Set();
    for (const state of screen.states) {
      if (typeof state.name !== "string" || !state.name) {
        problems.push(`screen ${name}: every state needs a name`);
        continue;
      }
      if (files.has(slug(state.name))) problems.push(`screen ${name}: state "${state.name}" clashes with another as ${slug(state.name)}`);
      files.add(slug(state.name));
      for (const device of state.devices ?? []) {
        if (!(device in DEVICES)) problems.push(`screen ${name}, state "${state.name}": unknown device ${device}`);
      }
      for (const [s, step] of (state.steps ?? []).entries()) {
        const problem = stepProblem(step);
        if (problem) problems.push(`screen ${name}, state "${state.name}", step ${s + 1}: ${problem}`);
      }
    }
  }
  if (problems.length) throw new Error(`scenarios:\n  ${problems.join("\n  ")}`);
  return { ...file, cookies: { persona: "flow-persona", scenario: "flow-scenario", ...file.cookies } };
}

export function stateCookies(state, names) {
  const cookies = [];
  if (state.persona) cookies.push({ name: names.persona, value: state.persona });
  if (state.scenario) cookies.push({ name: names.scenario, value: state.scenario });
  return cookies;
}

/* Clicks and POSTs go to the base URL unguarded, so it must be the throwaway copy on this machine. */
export function isLocalBase(base) {
  const { hostname } = new URL(base);
  return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d+){3}$/.test(hostname);
}
