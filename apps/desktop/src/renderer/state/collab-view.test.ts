import { describe, expect, it } from "vitest";

import {
  canAcquireLock,
  canCreateAssignment,
  inspectOpPayload,
  nextHeartbeatDelayMs,
  nextOpLogAfterSequence,
} from "./collab-view";

describe("collab-view", () => {
  it("gates lock/assignment availability", () => {
    expect(
      canAcquireLock({ projectId: "p", documentId: "d", segmentId: "s" }),
    ).toBe(true);
    expect(
      canAcquireLock({ projectId: "p", documentId: null, segmentId: "s" }),
    ).toBe(false);
    expect(
      canCreateAssignment({
        projectId: "p",
        documentId: "d",
        assigneeActorId: "u1",
        ordinalStart: 1,
        ordinalEnd: 3,
      }),
    ).toBe(true);
    expect(
      canCreateAssignment({
        projectId: "p",
        documentId: "d",
        assigneeActorId: "",
        ordinalStart: 3,
        ordinalEnd: 1,
      }),
    ).toBe(false);
  });

  it("advances op-log cursor from max sequence", () => {
    expect(nextOpLogAfterSequence(0, [])).toEqual({
      nextAfter: 0,
      canLoadMore: false,
    });
    expect(
      nextOpLogAfterSequence(0, [
        {
          id: "1",
          projectId: "p",
          sequence: 2,
          kind: "member.add",
          actorId: "a",
          createdAtMs: 1,
          payload: { x: 1 },
        },
        {
          id: "2",
          projectId: "p",
          sequence: 5,
          kind: "lock",
          actorId: "a",
          createdAtMs: 2,
          payload: null,
        },
      ]),
    ).toEqual({ nextAfter: 5, canLoadMore: true });
    expect(
      nextOpLogAfterSequence(5, [
        {
          id: "2",
          projectId: "p",
          sequence: 5,
          kind: "lock",
          actorId: "a",
          createdAtMs: 2,
          payload: null,
        },
      ]),
    ).toEqual({ nextAfter: 5, canLoadMore: false });
  });

  it("schedules heartbeat and inspects unknown payload safely", () => {
    expect(nextHeartbeatDelayMs(10_000)).toBeGreaterThanOrEqual(1000);
    expect(nextHeartbeatDelayMs(10_000)).toBeLessThanOrEqual(30_000);
    expect(inspectOpPayload({ a: 1 })).toBe('{"a":1}');
    expect(inspectOpPayload(undefined)).toBeNull();
  });
});
