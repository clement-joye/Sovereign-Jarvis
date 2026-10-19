import type { OutboundMessageV1 } from "@second-brain/contracts";

export interface MatrixTextOutboundEvent {
  msgtype: "m.text" | "m.notice";
  body: string;
  format: "org.matrix.custom.html";
  formatted_body: string;
  "m.relates_to"?: MatrixRelation;
}

export interface MatrixRelation {
  "m.in_reply_to"?: { event_id: string };
  rel_type?: "m.thread";
  event_id?: string;
  is_falling_back?: boolean;
}

export function matrixTransactionId(message: OutboundMessageV1): string {
  return `brain-${Buffer.from(message.idempotencyKey).toString("base64url")}`;
}

export function toMatrixTextOutbound(message: OutboundMessageV1): MatrixTextOutboundEvent {
  if (!message.text) {
    throw new Error("Only text outbound messages are supported by this mapper.");
  }

  const relatesTo = matrixRelation(message);
  const isNotice = message.presentation === "notice";

  return {
    msgtype: isNotice ? "m.notice" : "m.text",
    body: message.text,
    format: "org.matrix.custom.html",
    formatted_body: markdownToMatrixHtml(message.text),
    ...(relatesTo ? { "m.relates_to": relatesTo } : {})
  };
}

export function matrixRelation(message: OutboundMessageV1): MatrixRelation | undefined {
  const relatesTo: MatrixRelation = {};
  if (message.replyToExternalEventId) {
    relatesTo["m.in_reply_to"] = { event_id: message.replyToExternalEventId };
  }
  if (message.threadRootExternalEventId) {
    relatesTo.rel_type = "m.thread";
    relatesTo.event_id = message.threadRootExternalEventId;
    relatesTo.is_falling_back = true;
  }

  return Object.keys(relatesTo).length > 0 ? relatesTo : undefined;
}

/**
 * Produces the safe HTML representation required by Matrix clients. The plain
 * body remains available as a fallback for clients that do not render HTML.
 */
function markdownToMatrixHtml(markdown: string): string {
  const state: MarkdownRenderState = {
    output: [],
    paragraph: [],
    codeLines: undefined,
    listType: undefined
  };
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    consumeMarkdownLine(state, line);
  }
  if (state.codeLines) renderCodeBlock(state);
  flushParagraph(state);
  closeList(state);
  return state.output.join("\n");
}

type MarkdownBlock =
  | { type: "code-fence" }
  | { type: "blank" }
  | { type: "heading"; level: number; text: string }
  | { type: "list-item"; listType: "ul" | "ol"; text: string }
  | { type: "quote"; text: string }
  | { type: "rule" }
  | { type: "paragraph"; text: string };

interface MarkdownRenderState {
  output: string[];
  paragraph: string[];
  codeLines: string[] | undefined;
  listType: "ul" | "ol" | undefined;
}

function consumeMarkdownLine(state: MarkdownRenderState, line: string): void {
  if (state.codeLines) {
    if (classifyMarkdownLine(line).type === "code-fence") renderCodeBlock(state);
    else state.codeLines.push(line);
    return;
  }
  renderMarkdownBlock(state, classifyMarkdownLine(line));
}

function classifyMarkdownLine(line: string): MarkdownBlock {
  if (/^```/.test(line)) return { type: "code-fence" };
  if (/^\s*$/.test(line)) return { type: "blank" };
  const heading = /^(#{1,6})\s+(.+)$/.exec(line);
  if (heading) return { type: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" };
  const list = /^\s*(?:([-*+])\s+|(\d+[.)])\s+)(.*)$/.exec(line);
  if (list) {
    return { type: "list-item", listType: list[2] ? "ol" : "ul", text: list[3] ?? "" };
  }
  if (line.startsWith("> ")) return { type: "quote", text: line.slice(2) };
  if (/^([-*_])(?:\s*\1){2,}\s*$/.test(line)) return { type: "rule" };
  return { type: "paragraph", text: line };
}

function renderMarkdownBlock(state: MarkdownRenderState, block: MarkdownBlock): void {
  switch (block.type) {
    case "code-fence":
      flushParagraph(state);
      closeList(state);
      state.codeLines = [];
      return;
    case "blank":
      flushParagraph(state);
      closeList(state);
      return;
    case "heading":
      flushParagraph(state);
      closeList(state);
      state.output.push(`<h${block.level}>${renderInline(block.text)}</h${block.level}>`);
      return;
    case "list-item":
      flushParagraph(state);
      renderListItem(state, block);
      return;
    case "quote":
      flushParagraph(state);
      closeList(state);
      state.output.push(`<blockquote>${renderInline(block.text)}</blockquote>`);
      return;
    case "rule":
      flushParagraph(state);
      closeList(state);
      state.output.push("<hr>");
      return;
    case "paragraph":
      closeList(state);
      state.paragraph.push(block.text);
  }
}

function renderListItem(
  state: MarkdownRenderState,
  block: Extract<MarkdownBlock, { type: "list-item" }>
): void {
  if (state.listType && state.listType !== block.listType) closeList(state);
  if (!state.listType) {
    state.output.push(`<${block.listType}>`);
    state.listType = block.listType;
  }
  state.output.push(`<li>${renderInline(block.text)}</li>`);
}

function renderCodeBlock(state: MarkdownRenderState): void {
  state.output.push(`<pre><code>${escapeHtml(state.codeLines?.join("\n") ?? "")}</code></pre>`);
  state.codeLines = undefined;
}

function flushParagraph(state: MarkdownRenderState): void {
  if (state.paragraph.length === 0) return;
  state.output.push(`<p>${state.paragraph.map(renderInline).join("<br>")}</p>`);
  state.paragraph = [];
}

function closeList(state: MarkdownRenderState): void {
  if (!state.listType) return;
  state.output.push(`</${state.listType}>`);
  state.listType = undefined;
}

function renderInline(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
  return html;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}
