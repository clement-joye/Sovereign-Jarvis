import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { extractDocumentText } from "./document-extraction.js";

const execFileAsync = promisify(execFile);
const docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const hasPdftotext = commandAvailable("pdftotext");

describe("extractDocumentText", () => {
  it.skipIf(!hasPdftotext)("extracts text from a real PDF fixture", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-pdf-fixture-"));
    await mkdir(join(root, "inbound"));
    await writeFile(join(root, "inbound", "fixture.pdf"), pdfWithText("Private PDF fixture"));

    await expect(
      extractDocumentText(root, attachment("fixture.pdf", "application/pdf"))
    ).resolves.toContain("Private PDF fixture");
  });

  it("extracts text from a real DOCX container", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-docx-fixture-"));
    const source = join(root, "source");
    await mkdir(join(source, "word"), { recursive: true });
    await writeFile(join(source, "[Content_Types].xml"), "<Types/>");
    await writeFile(
      join(source, "word", "document.xml"),
      "<w:document><w:body><w:p><w:r><w:t>Private DOCX fixture</w:t></w:r></w:p></w:body></w:document>"
    );
    await mkdir(join(root, "inbound"));
    await execFileAsync("zip", ["-q", "-r", join(root, "inbound", "fixture.docx"), "."], {
      cwd: source
    });

    await expect(
      extractDocumentText(root, attachment("fixture.docx", docxType))
    ).resolves.toContain("Private DOCX fixture");
  });

  it("rejects a storage key that attempts to escape the attachment root", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-document-root-"));
    await expect(
      extractDocumentText(root, {
        ...attachment("fixture.txt", "text/plain"),
        storageKey: "../outside.txt"
      })
    ).rejects.toThrow("Invalid attachment storage key");
  });
});

function commandAvailable(command: string): boolean {
  try {
    execFileSync(command, ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function attachment(filename: string, mediaType: string) {
  return {
    schemaVersion: 1 as const,
    id: filename,
    purpose: "inbound" as const,
    mediaType,
    sizeBytes: 1,
    sha256: "a".repeat(64),
    storageKey: `inbound/${filename}`,
    originalFilename: filename
  };
}

function pdfWithText(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${`BT /F1 18 Tf 72 720 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 18 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
