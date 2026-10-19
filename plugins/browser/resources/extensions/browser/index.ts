import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertPublicHttpUrl } from "./public-url.ts";

// Port of local/tools/browser.py. Playwright-powered Browser* tools with
// per-session lazy Page launch, chunked Readability extract, history stack,
// graceful degradation when Playwright isn't installed.
//
// Playwright is installed only in the reviewed browser-runtime image.
// Other runtime classes never load this extension.

const CHUNK_SIZE = 2048;
const execFileAsync = promisify(execFile);
const FETCH_SCRIPT = "/opt/profile/browser/bin/browser-fetch.py";

// Inlined "Readability-lite": remove heavy structural nodes and collapse
// whitespace. Passed to page.evaluate as a real function (not a string) —
// Playwright silently returns undefined when given a string function literal
// like `"() => {...}"` because it evaluates to a function *value*, not an
// invocation. `document` is only defined in the page context.
function readablePageText(): string {
  const doc = (globalThis as any).document;
  const clone = doc.body.cloneNode(true);
  const drop = clone.querySelectorAll(
    "script, style, noscript, iframe, nav, header, footer, aside, form",
  );
  drop.forEach((n: any) => n.remove());
  const text = (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}
function fallbackPageText(): string {
  const doc = (globalThis as any).document;
  return doc.body ? doc.body.innerText : "";
}

interface BrowserSession {
  pw: any;
  browser: any;
  context: any;
  page: any;
  history: string[];
  extractCache: Map<string, string>;
  error: string;
}

const sessions = new Map<string, BrowserSession>();
const browserControlKey = Symbol.for("jarvis.runtime-action-control");

function sessionKey(): string {
  return process.env.LITTLE_CODER_SESSION_ID || "default";
}

function headful(): boolean {
  return !!process.env.BROWSER_HEADFUL;
}

async function ensureSession(): Promise<BrowserSession> {
  const key = sessionKey();
  let sess = sessions.get(key);
  if (!sess) {
    sess = {
      pw: null, browser: null, context: null, page: null,
      history: [], extractCache: new Map(), error: "",
    };
    sessions.set(key, sess);
  }
  if (sess.page || sess.error) return sess;
  try {
    // Optional runtime dep; cast avoids requiring @types/playwright at build time
    const playwright: any = await import("playwright" as any);
    const browser = await playwright.chromium.launch({ headless: !headful() });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (little-coder research agent)",
      viewport: { width: 1280, height: 900 },
    });
    await context.route("**/*", async (route: any) => {
      const requestUrl = route.request().url();
      const protocol = new URL(requestUrl).protocol;
      if (["about:", "blob:", "data:"].includes(protocol)) {
        await route.continue();
        return;
      }
      try {
        await assertPublicHttpUrl(requestUrl);
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    sess.pw = playwright;
    sess.browser = browser;
    sess.context = context;
    sess.page = page;
  } catch (e: any) {
    if (e?.code === "ERR_MODULE_NOT_FOUND" || /Cannot find module 'playwright'/.test(e?.message ?? "")) {
      sess.error = "Playwright is unavailable in this runtime.";
    } else {
      sess.error = `Browser launch failed: ${e?.message ?? e}`;
    }
  }
  return sess;
}

export async function resetBrowserSession(sessionId?: string): Promise<void> {
  const key = sessionId ?? sessionKey();
  const sess = sessions.get(key);
  if (!sess) return;
  sessions.delete(key);
  try { if (sess.page) await sess.page.close(); } catch {}
  try { if (sess.context) await sess.context.close(); } catch {}
  try { if (sess.browser) await sess.browser.close(); } catch {}
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {}, isError: true };
}
function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export async function executeBrowserMutationWithPage(
  page: any,
  operation: "browser-click" | "browser-type",
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const selector = typeof parameters.selector === "string" ? parameters.selector.trim() : "";
  if (!selector || selector.length > 500) throw new Error("Browser selector is invalid.");
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count !== 1) throw new Error(`Browser selector must match exactly one element; matched ${count}.`);
  if (!(await locator.isVisible())) throw new Error("Browser target is not visible.");
  if (!(await locator.isEnabled())) throw new Error("Browser target is not enabled.");

  if (operation === "browser-click") {
    await locator.click();
  } else if (operation === "browser-type") {
    const text = parameters.text;
    if (typeof text !== "string" || text.length > 4000) {
      throw new Error("Browser input text is invalid.");
    }
    const inputType = ((await locator.getAttribute("type")) ?? "").toLowerCase();
    if (inputType === "password" || inputType === "file") {
      throw new Error(`Browser typing into ${inputType} fields is forbidden.`);
    }
    await locator.fill(text);
  } else {
    throw new Error("Unsupported browser action.");
  }

  return { operation, selector, url: page.url(), title: await page.title() };
}

(globalThis as any)[browserControlKey] = {
  async execute(
    operation: "browser-click" | "browser-type",
    parameters: Record<string, unknown>,
  ) {
    const sess = sessions.get(sessionKey());
    if (!sess?.page) throw new Error("No active browser page is available for this approval.");
    return executeBrowserMutationWithPage(sess.page, operation, parameters);
  },
};

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "websearch",
    label: "websearch",
    description: "Search the public web and return up to eight results as Markdown.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
    async execute(_id, { query }) {
      const value = query.trim();
      if (!value) return errorResult("Error: query is required");
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        let response: Response;
        try {
          response = await fetch(
            `https://html.duckduckgo.com/html/?q=${encodeURIComponent(value)}`,
            {
              headers: { "User-Agent": "Mozilla/5.0 (Jarvis browser agent)" },
              redirect: "error",
              signal: controller.signal,
            },
          );
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) {
          return errorResult(`Error: search returned HTTP ${response.status}`);
        }
        return textResult(renderSearchResults(await response.text()));
      } catch (error: any) {
        return errorResult(`Error searching the web: ${error?.message ?? error}`);
      }
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "web_fetch",
    description:
      "Fetch one public static page or API. Returns final URL, HTTP status, title, readable text, and acquisition time. Use browser tools for rendered or interactive pages.",
    parameters: Type.Object({
      url: Type.String({ description: "Public http:// or https:// URL to fetch" }),
    }),
    async execute(_id, { url }) {
      const value = (url ?? "").trim();
      if (!value) return errorResult("Error: url is required");
      if (!value.startsWith("http://") && !value.startsWith("https://")) {
        return errorResult("Error: url must start with http:// or https://");
      }
      try {
        await assertPublicHttpUrl(value);
        const python = process.env.BROWSER_FETCH_PYTHON ?? "/opt/browser-venv/bin/python";
        const { stdout } = await execFileAsync(python, [FETCH_SCRIPT, value], {
          timeout: 30_000,
          maxBuffer: 256 * 1024,
        });
        return textResult(stdout.trim());
      } catch (error: any) {
        const detail = error?.stdout?.trim() || error?.stderr?.trim() || error?.message || String(error);
        return errorResult(`Error fetching ${value}: ${detail}`);
      }
    },
  });

  // ── BrowserNavigate ──────────────────────────────────────────────────
  pi.registerTool({
    name: "browser_navigate",
    label: "browser_navigate",
    description: "Navigate the browser to a URL. Must start with http:// or https://.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to navigate to" }),
    }),
    async execute(_id, { url }) {
      const u = (url ?? "").trim();
      if (!u) return errorResult("Error: url is required");
      if (!u.startsWith("http://") && !u.startsWith("https://")) {
        return errorResult("Error: url must start with http:// or https://");
      }
      const sess = await ensureSession();
      if (sess.error) return errorResult(`Error: ${sess.error}`);
      try {
        await assertPublicHttpUrl(u);
        const resp = await sess.page.goto(u, { waitUntil: "domcontentloaded" });
        sess.history.push(sess.page.url());
        sess.extractCache.clear();
        const status = resp ? resp.status() : "?";
        const title = await sess.page.title();
        return textResult(`[status=${status}] ${sess.page.url()}\ntitle: ${title}`);
      } catch (e: any) {
        return errorResult(`Error navigating to ${u}: ${e?.message ?? e}`);
      }
    },
  });

  // ── BrowserScroll ────────────────────────────────────────────────────
  pi.registerTool({
    name: "browser_scroll",
    label: "browser_scroll",
    description: "Scroll the current page up or down by a pixel amount (default 800px down).",
    parameters: Type.Object({
      direction: Type.Optional(Type.String({ description: "up or down" })),
      amount: Type.Optional(Type.Integer({ description: "Pixels (default 800)" })),
    }),
    async execute(_id, { direction, amount }) {
      const dir = ((direction ?? "down") as string).toLowerCase();
      const amt = typeof amount === "number" ? amount : 800;
      const sess = await ensureSession();
      if (sess.error) return errorResult(`Error: ${sess.error}`);
      const dy = dir === "down" ? amt : -amt;
      try {
        await sess.page.evaluate(`window.scrollBy(0, ${dy})`);
        return textResult(`scrolled ${dir} by ${amt}px`);
      } catch (e: any) {
        return errorResult(`Error scrolling: ${e?.message ?? e}`);
      }
    },
  });

  // ── BrowserExtract ───────────────────────────────────────────────────
  pi.registerTool({
    name: "browser_extract",
    label: "browser_extract",
    description:
      "Extract the current page's readable text. Returns a 2KB chunk with cursor+has_more " +
      "so one page can't swamp context. Call repeatedly with the last 'next=' cursor.",
    parameters: Type.Object({
      cursor: Type.Optional(Type.String({ description: "Byte offset to start from (default 0)" })),
    }),
    async execute(_id, { cursor }) {
      const sess = await ensureSession();
      if (sess.error) return errorResult(`Error: ${sess.error}`);
      try {
        if (!sess.extractCache.has("full")) {
          let text: string = await sess.page.evaluate(readablePageText);
          if (!text) {
            text = await sess.page.evaluate(fallbackPageText);
          }
          sess.extractCache.set("full", text ?? "");
        }
        const full = sess.extractCache.get("full") ?? "";
        const startRaw = parseInt((cursor ?? "0") as string, 10);
        const start = Number.isFinite(startRaw) ? startRaw : 0;
        if (start < 0 || start >= full.length) {
          return textResult(`[cursor=${start} past end (length=${full.length})]`);
        }
        const end = Math.min(start + CHUNK_SIZE, full.length);
        const chunk = full.slice(start, end);
        const hasMore = end < full.length;
        const footerBits = [
          `cursor=${start}`,
          `next=${hasMore ? end : "null"}`,
          `total=${full.length}`,
        ];
        if (hasMore) footerBits.push("has_more=true");
        return textResult(`${chunk}\n[${footerBits.join(" ")}]`);
      } catch (e: any) {
        return errorResult(`Error extracting: ${e?.message ?? e}`);
      }
    },
  });

  // ── BrowserBack ──────────────────────────────────────────────────────
  pi.registerTool({
    name: "browser_back",
    label: "browser_back",
    description: "Navigate back in the browser's history.",
    parameters: Type.Object({}),
    async execute() {
      const sess = await ensureSession();
      if (sess.error) return errorResult(`Error: ${sess.error}`);
      try {
        await sess.page.goBack({ waitUntil: "domcontentloaded" });
        sess.extractCache.clear();
        return textResult(`back. url=${sess.page.url()}`);
      } catch (e: any) {
        return errorResult(`Error going back: ${e?.message ?? e}`);
      }
    },
  });

  // ── BrowserHistory ───────────────────────────────────────────────────
  pi.registerTool({
    name: "browser_history",
    label: "browser_history",
    description: "List the last 20 URLs visited in this session.",
    parameters: Type.Object({}),
    async execute() {
      const sess = await ensureSession();
      if (sess.error) return errorResult(`Error: ${sess.error}`);
      if (sess.history.length === 0) return textResult("(no pages visited yet)");
      const lines = sess.history.slice(-20).map((u, i) => `${i + 1}. ${u}`);
      return textResult(lines.join("\n"));
    },
  });
}

export function renderSearchResults(body: string): string {
  const titlePattern =
    /class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetPattern = /class="result__snippet"[^>]*>([\s\S]*?)<\/div>/g;
  const results: Array<{ link: string; title: string }> = [];
  const snippets: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = titlePattern.exec(body)) && results.length < 8) {
    results.push({
      link: decodeHtml(match[1] ?? ""),
      title: decodeHtml(stripHtml(match[2] ?? "")),
    });
  }
  while ((match = snippetPattern.exec(body)) && snippets.length < 8) {
    snippets.push(decodeHtml(stripHtml(match[1] ?? "")));
  }
  if (results.length === 0) return "No results found";
  return results
    .map(({ title, link }, index) => `**${title}**\n${link}\n${snippets[index] ?? ""}`)
    .join("\n\n");
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
