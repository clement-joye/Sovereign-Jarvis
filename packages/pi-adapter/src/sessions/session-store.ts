import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface PiSessionRecord {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface PiSessionHealth {
  sessionId: string;
  exists: boolean;
  closed: boolean;
  path: string;
}

export interface PiSessionStore {
  create(sessionId: string): Promise<PiSessionRecord>;
  resume(sessionId: string): Promise<PiSessionRecord>;
  close(sessionId: string): Promise<PiSessionRecord>;
  health(sessionId: string): Promise<PiSessionHealth>;
  sessionPath(sessionId: string): string;
}

export function assertValidPiSessionId(sessionId: string): void {
  if (
    !SESSION_ID_PATTERN.test(sessionId) ||
    sessionId === "." ||
    sessionId === ".." ||
    sessionId.includes("..") ||
    sessionId.includes("/") ||
    sessionId.includes("\\")
  ) {
    throw new Error(`Invalid Pi session id: ${sessionId}`);
  }
}

export class FilePiSessionStore implements PiSessionStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async create(sessionId: string): Promise<PiSessionRecord> {
    const sessionPath = this.sessionPath(sessionId);
    await mkdir(sessionPath, { recursive: true });

    const existing = await this.tryRead(sessionId);
    if (existing && !existing.closedAt) {
      return existing;
    }

    const now = new Date().toISOString();
    const record: PiSessionRecord = {
      sessionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await this.write(record);
    return record;
  }

  async resume(sessionId: string): Promise<PiSessionRecord> {
    const record = await this.tryRead(sessionId);
    if (!record) {
      return this.create(sessionId);
    }
    if (record.closedAt) {
      throw new Error(`Pi session is closed: ${sessionId}`);
    }
    return record;
  }

  async close(sessionId: string): Promise<PiSessionRecord> {
    const record = await this.resume(sessionId);
    const updated: PiSessionRecord = {
      ...record,
      updatedAt: new Date().toISOString(),
      closedAt: new Date().toISOString()
    };
    await this.write(updated);
    return updated;
  }

  async health(sessionId: string): Promise<PiSessionHealth> {
    const record = await this.tryRead(sessionId);
    return {
      sessionId,
      exists: Boolean(record),
      closed: Boolean(record?.closedAt),
      path: this.sessionPath(sessionId)
    };
  }

  sessionPath(sessionId: string): string {
    assertValidPiSessionId(sessionId);
    const path = resolve(this.root, sessionId);
    if (path !== this.root && path.startsWith(`${this.root}${sep}`)) {
      return path;
    }
    throw new Error(`Pi session path escapes root: ${sessionId}`);
  }

  async destroyAllForTests(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  private metadataPath(sessionId: string): string {
    return join(this.sessionPath(sessionId), "session.json");
  }

  private async tryRead(sessionId: string): Promise<PiSessionRecord | undefined> {
    try {
      const raw = await readFile(this.metadataPath(sessionId), "utf8");
      return JSON.parse(raw) as PiSessionRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private async write(record: PiSessionRecord): Promise<void> {
    await mkdir(this.sessionPath(record.sessionId), { recursive: true });
    await writeFile(this.metadataPath(record.sessionId), `${JSON.stringify(record, null, 2)}\n`);
  }
}
