import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  DraftJournalRecord,
  DraftJournalSnapshot,
} from "../shared/product-shell.js";

const MAX_RECORDS = 200;
const MAX_TARGET_CHARS = 200_000;
const MAX_FILE_BYTES = 2_000_000;

export class DraftJournal {
  readonly #path: string;
  #queue: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.#path = join(dataDirectory, ".desktop", "draft-journal.json");
  }

  get path(): string {
    return this.#path;
  }

  withDataDirectory(dataDirectory: string): DraftJournal {
    return new DraftJournal(dataDirectory);
  }

  async list(): Promise<DraftJournalSnapshot> {
    await this.#queue;
    return this.#snapshot();
  }

  async #snapshot(): Promise<DraftJournalSnapshot> {
    const records = await this.#readRecords();
    let totalBytes: number;
    try {
      totalBytes = (await stat(this.#path)).size;
    } catch {
      totalBytes = 0;
    }
    return { path: this.#path, records, totalBytes };
  }

  async upsert(input: {
    projectId: string;
    documentId: string;
    segmentId: string;
    expectedRevision: number;
    targetText: string;
  }): Promise<DraftJournalSnapshot> {
    return this.#enqueue(async () => {
      const projectId = input.projectId.trim();
      const documentId = input.documentId.trim();
      const segmentId = input.segmentId.trim();
      if (!projectId || !documentId || !segmentId) {
        throw new Error(
          "Draft journal requires project, document, and segment IDs.",
        );
      }
      if (
        !Number.isFinite(input.expectedRevision) ||
        input.expectedRevision < 0
      ) {
        throw new Error("Draft journal expectedRevision is invalid.");
      }
      if (input.targetText.length > MAX_TARGET_CHARS) {
        throw new Error("Draft journal target text exceeds size limit.");
      }
      const records = await this.#readRecords();
      const next: DraftJournalRecord = {
        projectId,
        documentId,
        segmentId,
        expectedRevision: Math.trunc(input.expectedRevision),
        targetText: input.targetText,
        updatedAtMs: Date.now(),
        checksum: checksumTarget(input.targetText),
      };
      const without = records.filter((item) => item.segmentId !== segmentId);
      without.unshift(next);
      await this.#writeRecords(without.slice(0, MAX_RECORDS));
      return this.#snapshot();
    });
  }

  async clear(segmentIds?: string[]): Promise<DraftJournalSnapshot> {
    return this.#enqueue(async () => {
      if (!segmentIds || segmentIds.length === 0) {
        await this.#writeRecords([]);
        return this.#snapshot();
      }
      const deny = new Set(segmentIds);
      const records = (await this.#readRecords()).filter(
        (item) => !deny.has(item.segmentId),
      );
      await this.#writeRecords(records);
      return this.#snapshot();
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation, operation);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #readRecords(): Promise<DraftJournalRecord[]> {
    try {
      const raw = await readFile(this.#path, "utf8");
      if (raw.length > MAX_FILE_BYTES) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || !Array.isArray(parsed.records)) return [];
      return parsed.records
        .filter(isRecord)
        .map((item) => ({
          projectId: stringField(item.projectId),
          documentId: stringField(item.documentId),
          segmentId: stringField(item.segmentId),
          expectedRevision: Number(item.expectedRevision ?? 0),
          targetText: stringField(item.targetText),
          updatedAtMs: Number(item.updatedAtMs ?? 0),
          checksum: stringField(item.checksum),
        }))
        .filter(
          (item) =>
            item.projectId &&
            item.documentId &&
            item.segmentId &&
            item.checksum === checksumTarget(item.targetText),
        )
        .slice(0, MAX_RECORDS);
    } catch {
      return [];
    }
  }

  async #writeRecords(records: DraftJournalRecord[]): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const payload = `${JSON.stringify({ version: 1, records }, null, 2)}\n`;
    if (Buffer.byteLength(payload, "utf8") > MAX_FILE_BYTES) {
      throw new Error("Draft journal would exceed size limit.");
    }
    const temp = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, payload, "utf8");
    await rename(temp, this.#path);
  }
}

export function checksumTarget(targetText: string): string {
  return createHash("sha256").update(targetText, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}
