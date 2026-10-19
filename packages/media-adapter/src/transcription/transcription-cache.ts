import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TranscriptionResult } from "../index.js";

const CACHE_SCHEMA_VERSION = 1;

interface CacheRecord {
  schemaVersion: number;
  cacheKey: string;
  createdAt: string;
  result: TranscriptionResult;
}

export interface TranscriptionCache {
  get(cacheKey: string): Promise<TranscriptionResult | undefined>;
  put(cacheKey: string, result: TranscriptionResult): Promise<void>;
}

export class FileTranscriptionCache implements TranscriptionCache {
  constructor(
    private readonly root: string,
    private readonly maxAgeMs: number,
    private readonly maxBytes = Number.POSITIVE_INFINITY,
    private readonly now: () => Date = () => new Date()
  ) {}

  async get(cacheKey: string): Promise<TranscriptionResult | undefined> {
    try {
      const raw = await readFile(this.pathFor(cacheKey), "utf8");
      const record = parseRecord(raw);
      if (
        record === undefined ||
        record.cacheKey !== cacheKey ||
        this.now().getTime() - Date.parse(record.createdAt) > this.maxAgeMs
      ) {
        return undefined;
      }
      return record.result;
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      return undefined;
    }
  }

  async put(cacheKey: string, result: TranscriptionResult): Promise<void> {
    const path = this.pathFor(cacheKey);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const record: CacheRecord = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      cacheKey,
      createdAt: this.now().toISOString(),
      result
    };
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
    if (bytes.byteLength > this.maxBytes) {
      return;
    }
    await this.prune(bytes.byteLength);
    const temporary = `${path}.tmp-${randomUUID()}`;
    await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  }

  private async prune(incomingBytes: number): Promise<void> {
    const entries = await readdir(this.root, { withFileTypes: true });
    const cached = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const path = join(this.root, entry.name);
          const details = await stat(path);
          return { path, size: details.size, modifiedAtMs: details.mtimeMs };
        })
    );
    const nowMs = this.now().getTime();
    const active = [] as typeof cached;
    for (const entry of cached) {
      if (nowMs - entry.modifiedAtMs > this.maxAgeMs) {
        await rm(entry.path, { force: true });
      } else {
        active.push(entry);
      }
    }
    let retainedBytes = active.reduce((total, entry) => total + entry.size, 0);
    for (const entry of active.sort((left, right) => left.modifiedAtMs - right.modifiedAtMs)) {
      if (retainedBytes + incomingBytes <= this.maxBytes) {
        break;
      }
      await rm(entry.path, { force: true });
      retainedBytes -= entry.size;
    }
  }

  private pathFor(cacheKey: string): string {
    return join(this.root, `${createHash("sha256").update(cacheKey).digest("hex")}.json`);
  }
}

function parseRecord(raw: string): CacheRecord | undefined {
  const value = parseJsonObject(raw);
  if (!value) return undefined;
  const metadata = parseCacheMetadata(value);
  const result = parseTranscriptionResult(value.result);
  if (!metadata || !result) return undefined;
  return { ...metadata, result };
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function parseCacheMetadata(
  value: Record<string, unknown>
): Omit<CacheRecord, "result"> | undefined {
  if (
    value.schemaVersion !== CACHE_SCHEMA_VERSION ||
    typeof value.cacheKey !== "string" ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt))
  ) {
    return undefined;
  }
  return {
    schemaVersion: value.schemaVersion,
    cacheKey: value.cacheKey,
    createdAt: value.createdAt
  };
}

function parseTranscriptionResult(value: unknown): TranscriptionResult | undefined {
  if (!isRecord(value) || typeof value.text !== "string" || !Array.isArray(value.warnings)) {
    return undefined;
  }
  if (
    !value.warnings.every((warning) => typeof warning === "string") ||
    typeof value.cacheKey !== "string" ||
    (value.language !== undefined && typeof value.language !== "string") ||
    (value.confidence !== undefined && typeof value.confidence !== "number")
  ) {
    return undefined;
  }
  return {
    text: value.text,
    ...(typeof value.language === "string" ? { language: value.language } : {}),
    ...(typeof value.confidence === "number" ? { confidence: value.confidence } : {}),
    warnings: value.warnings,
    cacheKey: value.cacheKey
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
