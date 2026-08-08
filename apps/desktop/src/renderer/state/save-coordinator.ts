import type { Segment } from "@translunar/contracts";

import { toUiError, type UiError } from "../lib/errors";
import { desktopApi, invokeEngine } from "../lib/rpc";

export type SaveState = "idle" | "scheduled" | "saving" | "error";

export interface SegmentEditState {
  segmentId: string;
  documentId: string;
  projectId: string;
  engineTarget: string;
  draftTarget: string;
  expectedRevision: number;
  editGeneration: number;
  savedGeneration: number;
  saveState: SaveState;
  error: UiError | null;
  /** Journal persistence failure independent of Engine save success. */
  journalError: UiError | null;
  isComposing: boolean;
}

export interface FlushResult {
  /** Segment from this flush only; one-shot, not sticky across later calls. */
  updatedSegment: Segment | null;
  journalError: UiError | null;
}

export interface SaveCoordinatorOptions {
  journalDebounceMs?: number;
  saveDebounceMs?: number;
  onChange?: () => void;
}

const DEFAULT_JOURNAL_MS = 150;
const DEFAULT_SAVE_MS = 350;

/**
 * One active-segment save queue with edit generations and draft journal.
 * Domain status remains Engine-owned; this only manages local draft persistence.
 */
export class SaveCoordinator {
  #active: SegmentEditState | null = null;
  #journalTimer: ReturnType<typeof setTimeout> | null = null;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #inflight: Promise<void> | null = null;
  #onChange: (() => void) | null = null;
  readonly #journalDebounceMs: number;
  readonly #saveDebounceMs: number;
  /**
   * Segment produced by the most recent successful domain save in this session.
   * Consumed by takeLastUpdatedSegment() so callers cannot reapply stale responses.
   */
  #lastUpdatedSegment: Segment | null = null;

  constructor(options: SaveCoordinatorOptions = {}) {
    this.#journalDebounceMs = options.journalDebounceMs ?? DEFAULT_JOURNAL_MS;
    this.#saveDebounceMs = options.saveDebounceMs ?? DEFAULT_SAVE_MS;
    this.#onChange = options.onChange ?? null;
  }

  get active(): SegmentEditState | null {
    return this.#active;
  }

  isDirty(): boolean {
    if (!this.#active) return false;
    return (
      this.#active.editGeneration !== this.#active.savedGeneration ||
      this.#active.draftTarget !== this.#active.engineTarget ||
      this.#active.saveState === "saving" ||
      this.#active.saveState === "scheduled"
    );
  }

  /**
   * One-shot consumption of the last Engine update for this coordinator.
   * Callers must apply the result immediately; subsequent calls return null until a new save.
   */
  takeLastUpdatedSegment(): Segment | null {
    const segment = this.#lastUpdatedSegment;
    this.#lastUpdatedSegment = null;
    return segment;
  }

  attachSegment(input: {
    segmentId: string;
    documentId: string;
    projectId: string;
    engineTarget: string;
    expectedRevision: number;
    initialDraft?: string;
  }): void {
    this.#clearTimers();
    this.#lastUpdatedSegment = null;
    const draft = input.initialDraft ?? input.engineTarget;
    const dirty = draft !== input.engineTarget;
    this.#active = {
      segmentId: input.segmentId,
      documentId: input.documentId,
      projectId: input.projectId,
      engineTarget: input.engineTarget,
      draftTarget: draft,
      expectedRevision: input.expectedRevision,
      editGeneration: dirty ? 1 : 0,
      savedGeneration: 0,
      saveState: dirty ? "scheduled" : "idle",
      error: null,
      journalError: null,
      isComposing: false,
    };
    if (dirty) {
      this.#scheduleJournal();
      this.#scheduleSave();
    }
    this.#emit();
  }

  clearActive(): void {
    this.#clearTimers();
    this.#active = null;
    this.#lastUpdatedSegment = null;
    this.#emit();
  }

  setComposing(isComposing: boolean): void {
    if (!this.#active) return;
    this.#active.isComposing = isComposing;
    if (isComposing) {
      // Pause domain-save timer; keep draft + journal for crash recovery only.
      if (this.#saveTimer) {
        clearTimeout(this.#saveTimer);
        this.#saveTimer = null;
      }
    } else if (
      this.#active.editGeneration !== this.#active.savedGeneration ||
      this.#active.draftTarget !== this.#active.engineTarget
    ) {
      this.#active.saveState = "scheduled";
      this.#scheduleSave();
    }
    this.#emit();
  }

  updateDraft(text: string): void {
    if (!this.#active) return;
    this.#active.draftTarget = text;
    this.#active.editGeneration += 1;
    this.#active.saveState = "scheduled";
    this.#active.error = null;
    this.#scheduleJournal();
    if (!this.#active.isComposing) {
      this.#scheduleSave();
    } else if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    this.#emit();
  }

  applyEngineSegment(segment: Segment): void {
    if (!this.#active || this.#active.segmentId !== segment.id) return;
    // Only adopt engine target when no newer local draft exists.
    if (this.#active.editGeneration === this.#active.savedGeneration) {
      this.#active.engineTarget = segment.targetText;
      this.#active.draftTarget = segment.targetText;
      this.#active.expectedRevision = segment.revision;
    } else {
      this.#active.expectedRevision = segment.revision;
      this.#active.engineTarget = segment.targetText;
    }
    this.#emit();
  }

  /**
   * Force-flush draft to journal + Engine when not composing.
   * Serializes until the submitted generation matches the current edit generation
   * (so typing during an in-flight updateTarget is not dropped by a premature return).
   * Returns a one-shot acknowledgement for the last successful domain save in this flush.
   */
  async flush(): Promise<FlushResult> {
    this.#clearTimers();
    if (this.#inflight) await this.#inflight;
    if (!this.#active) {
      return { updatedSegment: null, journalError: null };
    }
    if (this.#active.isComposing) {
      // Never mutate Engine mid-composition; journal local draft only.
      await this.#writeJournalNow();
      return {
        updatedSegment: null,
        journalError: this.#active.journalError,
      };
    }

    let lastUpdated: Segment | null = null;
    let journalError: UiError | null = this.#active.journalError;
    // Bound iterations: concurrent edits re-dirty after each save; abort runaway loops.
    for (let attempt = 0; attempt < 32; attempt += 1) {
      if (!this.#active) {
        return { updatedSegment: lastUpdated, journalError };
      }
      if (this.#active.isComposing) {
        await this.#writeJournalNow();
        return {
          updatedSegment: lastUpdated,
          journalError: this.#active.journalError ?? journalError,
        };
      }
      const generationStable =
        this.#active.editGeneration === this.#active.savedGeneration &&
        this.#active.draftTarget === this.#active.engineTarget;
      if (generationStable && this.#active.saveState !== "error") {
        return {
          updatedSegment: lastUpdated,
          journalError: this.#active.journalError ?? journalError,
        };
      }

      await this.#writeJournalNow();
      // Prefer journal write outcome before domain save/clear can overwrite it.
      journalError = this.#active?.journalError ?? journalError;
      await this.#saveNow();
      if (this.#active?.saveState === "error") {
        throw Object.assign(
          new Error(this.#active.error?.message ?? "Save failed"),
          {
            uiError: this.#active.error,
          },
        );
      }
      const updated = this.takeLastUpdatedSegment();
      if (updated) lastUpdated = updated;
      // If a newer generation arrived while save was in flight, loop without debounce.
    }

    return {
      updatedSegment: lastUpdated,
      journalError: this.#active?.journalError ?? journalError,
    };
  }

  async discardJournal(segmentIds?: string[]): Promise<void> {
    await desktopApi().clearDraftJournal(segmentIds);
  }

  #scheduleJournal(): void {
    if (this.#journalTimer) clearTimeout(this.#journalTimer);
    this.#journalTimer = setTimeout(() => {
      this.#journalTimer = null;
      void this.#writeJournalNow();
    }, this.#journalDebounceMs);
  }

  #scheduleSave(): void {
    if (this.#active?.isComposing) return;
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.#runSaveQueue();
    }, this.#saveDebounceMs);
  }

  #clearTimers(): void {
    if (this.#journalTimer) {
      clearTimeout(this.#journalTimer);
      this.#journalTimer = null;
    }
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
  }

  async #writeJournalNow(): Promise<void> {
    const active = this.#active;
    if (!active) return;
    try {
      await desktopApi().writeDraftJournal({
        projectId: active.projectId,
        documentId: active.documentId,
        segmentId: active.segmentId,
        expectedRevision: active.expectedRevision,
        targetText: active.draftTarget,
      });
      if (this.#active?.segmentId === active.segmentId) {
        this.#active.journalError = null;
        this.#emit();
      }
    } catch (error) {
      if (this.#active?.segmentId === active.segmentId) {
        this.#active.journalError = toUiError(
          error,
          "Draft journal write failed",
        );
        this.#emit();
      }
    }
  }

  async #runSaveQueue(): Promise<void> {
    if (this.#inflight) {
      await this.#inflight;
      // After inflight completes, schedule another if still dirty and not composing.
      if (
        this.#active &&
        !this.#active.isComposing &&
        this.#active.editGeneration !== this.#active.savedGeneration
      ) {
        await this.#saveNow();
      }
      return;
    }
    await this.#saveNow();
  }

  async #saveNow(): Promise<void> {
    const active = this.#active;
    if (!active) return;
    if (active.isComposing) {
      // Defensive: never send intermediate composition text to Engine.
      return;
    }
    if (
      active.editGeneration === active.savedGeneration &&
      active.draftTarget === active.engineTarget
    ) {
      active.saveState = "idle";
      this.#emit();
      return;
    }

    const submittedGeneration = active.editGeneration;
    const submittedText = active.draftTarget;
    const submittedRevision = active.expectedRevision;
    const submittedSegmentId = active.segmentId;
    active.saveState = "saving";
    active.error = null;
    this.#emit();

    const run = (async () => {
      try {
        const segment = await invokeEngine("segment.updateTarget", {
          segmentId: submittedSegmentId,
          expectedRevision: submittedRevision,
          targetText: submittedText,
        });
        // Only acknowledge if this is still the active segment.
        if (this.#active?.segmentId !== submittedSegmentId) return;
        // One-shot acknowledgement for this exact save (consumed by flush / take).
        this.#lastUpdatedSegment = segment;
        if (this.#active.editGeneration === submittedGeneration) {
          this.#active.savedGeneration = submittedGeneration;
          this.#active.engineTarget = segment.targetText;
          this.#active.draftTarget = segment.targetText;
          this.#active.expectedRevision = segment.revision;
          this.#active.saveState = "idle";
          this.#active.error = null;
          try {
            await desktopApi().clearDraftJournal([submittedSegmentId]);
            // Do not clear a prior journal *write* error here — only clear
            // when a later successful write proves journal durability again.
          } catch (error) {
            if (this.#active?.segmentId === submittedSegmentId) {
              // Engine save succeeded; journal clear failure is recovery-state only.
              this.#active.journalError = toUiError(
                error,
                "Draft journal clear failed",
              );
            }
          }
        } else {
          // Newer draft exists; keep dirty and update baseline revision from engine.
          this.#active.expectedRevision = segment.revision;
          this.#active.engineTarget = segment.targetText;
          this.#active.saveState = this.#active.isComposing
            ? "scheduled"
            : "scheduled";
        }
        this.#emit();
        if (
          this.#active &&
          !this.#active.isComposing &&
          this.#active.editGeneration !== this.#active.savedGeneration
        ) {
          this.#scheduleSave();
        }
      } catch (error) {
        if (this.#active?.segmentId !== submittedSegmentId) return;
        this.#active.saveState = "error";
        this.#active.error = toUiError(error, "Save failed");
        this.#emit();
      }
    })();

    this.#inflight = run.finally(() => {
      this.#inflight = null;
    });
    await this.#inflight;
  }

  #emit(): void {
    if (this.#onChange) this.#onChange();
  }
}
