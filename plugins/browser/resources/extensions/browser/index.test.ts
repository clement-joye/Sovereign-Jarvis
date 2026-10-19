import { describe, expect, it, vi } from "vitest";

import { executeBrowserMutationWithPage, renderSearchResults } from "./index.js";

function page(inputType = "text", count = 1) {
  const locator = {
    count: vi.fn().mockResolvedValue(count),
    isVisible: vi.fn().mockResolvedValue(true),
    isEnabled: vi.fn().mockResolvedValue(true),
    getAttribute: vi.fn().mockResolvedValue(inputType),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined)
  };
  return {
    locator,
    page: {
      locator: vi.fn(() => locator),
      url: vi.fn(() => "https://example.test/form"),
      title: vi.fn().mockResolvedValue("Form")
    }
  };
}

describe("approved browser mutation", () => {
  it("clicks exactly one visible enabled target", async () => {
    const fake = page();
    await executeBrowserMutationWithPage(fake.page, "browser-click", { selector: "#save" });
    expect(fake.locator.click).toHaveBeenCalledOnce();
  });

  it("replaces text but refuses password and file fields", async () => {
    const fake = page();
    await executeBrowserMutationWithPage(fake.page, "browser-type", {
      selector: "#name",
      text: "Jarvis"
    });
    expect(fake.locator.fill).toHaveBeenCalledWith("Jarvis");

    await expect(
      executeBrowserMutationWithPage(page("password").page, "browser-type", {
        selector: "#secret",
        text: "nope"
      })
    ).rejects.toThrow("password fields is forbidden");
    await expect(
      executeBrowserMutationWithPage(page("file").page, "browser-type", {
        selector: "#upload",
        text: "/tmp/file"
      })
    ).rejects.toThrow("file fields is forbidden");
  });

  it("rejects selectors that are absent or ambiguous", async () => {
    await expect(
      executeBrowserMutationWithPage(page("text", 2).page, "browser-click", {
        selector: "button"
      })
    ).rejects.toThrow("match exactly one element");
  });
});

describe("browser web search", () => {
  it("renders search results without leaking markup", () => {
    const body = `
      <div class="result__title"><a href="https://example.test/?a=1&amp;b=2">Example &amp; result</a></div>
      <div class="result__snippet">A <strong>useful</strong> result.</div>
    `;

    expect(renderSearchResults(body)).toBe(
      "**Example & result**\nhttps://example.test/?a=1&b=2\nA useful result."
    );
  });

  it("reports an empty result page", () => {
    expect(renderSearchResults("<html></html>")).toBe("No results found");
  });
});
