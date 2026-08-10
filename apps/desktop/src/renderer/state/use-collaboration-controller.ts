import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CollabAssignment,
  CollabLock,
  CollabMember,
  CollabOpLogEntry,
  CollabPresence,
  CollabRole,
} from "@translunar/contracts";

import { toUiError, type UiError } from "../lib/errors";
import { invokeEngine } from "../lib/rpc";
import {
  canAcquireLock,
  canCreateAssignment,
  nextHeartbeatDelayMs,
  nextOpLogAfterSequence,
} from "./collab-view";
import type { P4ProjectContext } from "./p4-route-context";

export interface CollaborationGateway {
  generation: number;
  mutationsEnabled: boolean;
  active: boolean;
  section: string;
  context: P4ProjectContext;
}

export interface CollaborationState {
  loading: boolean;
  error: UiError | null;
  members: CollabMember[];
  locks: CollabLock[];
  presence: CollabPresence[];
  assignments: CollabAssignment[];
  opLog: CollabOpLogEntry[];
  opLogAfter: number;
  opLogCanLoadMore: boolean;
  actorId: string;
  newMemberId: string;
  newMemberRole: CollabRole;
  assigneeActorId: string;
  ordinalStart: number;
  ordinalEnd: number;
  presenceActive: boolean;
  mutationPending: boolean;
}

type Domain = "members" | "locks" | "presence" | "assignments" | "opLog";

function initialState(): CollaborationState {
  return {
    loading: false,
    error: null,
    members: [],
    locks: [],
    presence: [],
    assignments: [],
    opLog: [],
    opLogAfter: 0,
    opLogCanLoadMore: false,
    actorId: "local-user",
    newMemberId: "",
    newMemberRole: "member",
    assigneeActorId: "",
    ordinalStart: 1,
    ordinalEnd: 1,
    presenceActive: false,
    mutationPending: false,
  };
}

export interface CollaborationControllerApi {
  state: CollaborationState;
  invalidate: () => void;
  setActorId: (v: string) => void;
  setNewMemberId: (v: string) => void;
  setNewMemberRole: (v: CollabRole) => void;
  setAssignee: (v: string) => void;
  setOrdinalRange: (start: number, end: number) => void;
  reloadMembers: () => Promise<void>;
  addMember: () => Promise<void>;
  removeMember: (actorId: string) => Promise<void>;
  reloadLocks: () => Promise<void>;
  acquireLock: () => Promise<void>;
  releaseLock: (segmentId: string) => Promise<void>;
  heartbeatLock: (segmentId: string) => Promise<void>;
  reloadPresence: () => Promise<void>;
  startPresence: () => Promise<void>;
  stopPresence: () => void;
  reloadAssignments: () => Promise<void>;
  createAssignment: () => Promise<void>;
  completeAssignment: (id: string, revision: number) => Promise<void>;
  reloadOpLog: (reset?: boolean) => Promise<void>;
  loadMoreOpLog: () => Promise<void>;
}

export function useCollaborationController(
  gateway: CollaborationGateway,
): CollaborationControllerApi {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;
  const ops = useRef<Record<Domain, number>>({
    members: 0,
    locks: 0,
    presence: 0,
    assignments: 0,
    opLog: 0,
  });
  const pending = useRef<Record<Domain, number>>({
    members: 0,
    locks: 0,
    presence: 0,
    assignments: 0,
    opLog: 0,
  });
  const genRef = useRef(gateway.generation);
  const presenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPresenceTimer = useCallback(() => {
    if (presenceTimer.current) {
      clearTimeout(presenceTimer.current);
      presenceTimer.current = null;
    }
  }, []);

  const current = useCallback((d: Domain, op: number) => {
    return (
      gatewayRef.current.active &&
      gatewayRef.current.generation === genRef.current &&
      ops.current[d] === op
    );
  }, []);

  const begin = useCallback((d: Domain): number | null => {
    if (!gatewayRef.current.mutationsEnabled) return null;
    if (pending.current[d] > 0) return null;
    const op = ++ops.current[d];
    pending.current[d] = op;
    return op;
  }, []);

  const end = useCallback((d: Domain, op: number) => {
    if (pending.current[d] === op) pending.current[d] = 0;
  }, []);

  const stopPresence = useCallback(() => {
    clearPresenceTimer();
    setState((s) => ({ ...s, presenceActive: false }));
  }, [clearPresenceTimer]);

  const invalidate = useCallback(() => {
    genRef.current = gatewayRef.current.generation;
    for (const k of Object.keys(ops.current) as Domain[]) {
      ops.current[k] += 1;
      pending.current[k] = 0;
    }
    stopPresence();
    setState((s) =>
      s.mutationPending ? { ...s, mutationPending: false } : s,
    );
  }, [stopPresence]);

  useEffect(() => {
    if (gateway.generation !== genRef.current) invalidate();
  }, [gateway.generation, invalidate]);

  useEffect(() => () => clearPresenceTimer(), [clearPresenceTimer]);

  const projectId = () => gatewayRef.current.context.projectId;

  const reloadMembers = useCallback(async () => {
    const op = ++ops.current.members;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await invokeEngine("collab.member.list", {
        projectId: projectId(),
      });
      if (!current("members", op)) return;
      setState((s) => ({
        ...s,
        loading: false,
        members: result.items,
      }));
    } catch (error) {
      if (!current("members", op)) return;
      setState((s) => ({
        ...s,
        loading: false,
        error: toUiError(error),
      }));
    }
  }, [current]);

  const addMember = useCallback(async () => {
    const actorId = stateRef.current.newMemberId.trim();
    if (!actorId) return;
    const op = begin("members");
    if (op === null) return;
    setState((s) => ({ ...s, mutationPending: true, error: null }));
    try {
      await invokeEngine("collab.member.add", {
        projectId: projectId(),
        actorId,
        role: stateRef.current.newMemberRole,
        actingActor: stateRef.current.actorId,
      });
      if (!current("members", op)) return;
      end("members", op);
      setState((s) => ({
        ...s,
        mutationPending: false,
        newMemberId: "",
      }));
      await reloadMembers();
    } catch (error) {
      if (!current("members", op)) return;
      end("members", op);
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [begin, current, end, reloadMembers]);

  const removeMember = useCallback(
    async (actorId: string) => {
      const op = begin("members");
      if (op === null) return;
      try {
        await invokeEngine("collab.member.remove", {
          projectId: projectId(),
          actorId,
          actingActor: stateRef.current.actorId,
        });
        if (!current("members", op)) return;
        end("members", op);
        await reloadMembers();
      } catch (error) {
        if (!current("members", op)) return;
        end("members", op);
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [begin, current, end, reloadMembers],
  );

  const reloadLocks = useCallback(async () => {
    const op = ++ops.current.locks;
    try {
      const result = await invokeEngine("collab.lock.list", {
        projectId: projectId(),
      });
      if (!current("locks", op)) return;
      setState((s) => ({ ...s, locks: result.items }));
    } catch (error) {
      if (!current("locks", op)) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [current]);

  const acquireLock = useCallback(async () => {
    const ctx = gatewayRef.current.context;
    if (
      !canAcquireLock({
        projectId: ctx.projectId,
        documentId: ctx.documentId,
        segmentId: ctx.activeSegmentId,
      })
    ) {
      return;
    }
    const op = begin("locks");
    if (op === null) return;
    try {
      await invokeEngine("collab.lock.acquire", {
        projectId: ctx.projectId,
        documentId: ctx.documentId!,
        segmentId: ctx.activeSegmentId!,
        actorId: stateRef.current.actorId,
      });
      if (!current("locks", op)) return;
      end("locks", op);
      await reloadLocks();
    } catch (error) {
      if (!current("locks", op)) return;
      end("locks", op);
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [begin, current, end, reloadLocks]);

  const releaseLock = useCallback(
    async (segmentId: string) => {
      const op = begin("locks");
      if (op === null) return;
      try {
        await invokeEngine("collab.lock.release", {
          segmentId,
          actorId: stateRef.current.actorId,
        });
        if (!current("locks", op)) return;
        end("locks", op);
        await reloadLocks();
      } catch (error) {
        if (!current("locks", op)) return;
        end("locks", op);
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [begin, current, end, reloadLocks],
  );

  const heartbeatLock = useCallback(
    async (segmentId: string) => {
      const op = begin("locks");
      if (op === null) return;
      try {
        await invokeEngine("collab.lock.heartbeat", {
          segmentId,
          actorId: stateRef.current.actorId,
        });
        if (!current("locks", op)) return;
        end("locks", op);
        await reloadLocks();
      } catch (error) {
        if (!current("locks", op)) return;
        end("locks", op);
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [begin, current, end, reloadLocks],
  );

  const reloadPresence = useCallback(async () => {
    const op = ++ops.current.presence;
    try {
      const result = await invokeEngine("collab.presence.list", {
        projectId: projectId(),
      });
      if (!current("presence", op)) return;
      setState((s) => ({ ...s, presence: result.items }));
    } catch (error) {
      if (!current("presence", op)) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [current]);

  const schedulePresence = useCallback(
    (expiresAtMs: number | null, ttlMs: number) => {
      clearPresenceTimer();
      const delay = nextHeartbeatDelayMs(ttlMs, Date.now(), expiresAtMs);
      presenceTimer.current = setTimeout(() => {
        void (async () => {
          if (!stateRef.current.presenceActive) return;
          if (!gatewayRef.current.active) return;
          const ctx = gatewayRef.current.context;
          try {
            const presence = await invokeEngine("collab.presence.heartbeat", {
              projectId: ctx.projectId,
              actorId: stateRef.current.actorId,
              documentId: ctx.documentId,
              segmentId: ctx.activeSegmentId,
              ttlMs: 30_000,
            });
            if (!gatewayRef.current.active) return;
            schedulePresence(presence.expiresAtMs, 30_000);
            await reloadPresence();
          } catch (error) {
            if (!gatewayRef.current.active) return;
            setState((s) => ({
              ...s,
              presenceActive: false,
              error: toUiError(error),
            }));
            clearPresenceTimer();
          }
        })();
      }, delay);
    },
    [clearPresenceTimer, reloadPresence],
  );

  const startPresence = useCallback(async () => {
    const op = begin("presence");
    if (op === null) return;
    const ctx = gatewayRef.current.context;
    try {
      const presence = await invokeEngine("collab.presence.heartbeat", {
        projectId: ctx.projectId,
        actorId: stateRef.current.actorId,
        documentId: ctx.documentId,
        segmentId: ctx.activeSegmentId,
        ttlMs: 30_000,
      });
      if (!current("presence", op)) return;
      end("presence", op);
      setState((s) => ({ ...s, presenceActive: true }));
      schedulePresence(presence.expiresAtMs, 30_000);
      await reloadPresence();
    } catch (error) {
      if (!current("presence", op)) return;
      end("presence", op);
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [begin, current, end, reloadPresence, schedulePresence]);

  const reloadAssignments = useCallback(async () => {
    const op = ++ops.current.assignments;
    try {
      const result = await invokeEngine("collab.assignment.list", {
        projectId: projectId(),
      });
      if (!current("assignments", op)) return;
      setState((s) => ({ ...s, assignments: result.items }));
    } catch (error) {
      if (!current("assignments", op)) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [current]);

  const createAssignment = useCallback(async () => {
    const ctx = gatewayRef.current.context;
    const input = {
      projectId: ctx.projectId,
      documentId: ctx.documentId,
      assigneeActorId: stateRef.current.assigneeActorId,
      ordinalStart: stateRef.current.ordinalStart,
      ordinalEnd: stateRef.current.ordinalEnd,
    };
    if (!canCreateAssignment(input)) return;
    const op = begin("assignments");
    if (op === null) return;
    try {
      await invokeEngine("collab.assignment.create", {
        projectId: ctx.projectId,
        documentId: ctx.documentId!,
        assigneeActorId: input.assigneeActorId,
        ordinalStart: input.ordinalStart,
        ordinalEnd: input.ordinalEnd,
        createdBy: stateRef.current.actorId,
      });
      if (!current("assignments", op)) return;
      end("assignments", op);
      await reloadAssignments();
    } catch (error) {
      if (!current("assignments", op)) return;
      end("assignments", op);
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [begin, current, end, reloadAssignments]);

  const completeAssignment = useCallback(
    async (id: string, revision: number) => {
      const op = begin("assignments");
      if (op === null) return;
      try {
        await invokeEngine("collab.assignment.complete", {
          assignmentId: id,
          expectedRevision: revision,
        });
        if (!current("assignments", op)) return;
        end("assignments", op);
        await reloadAssignments();
      } catch (error) {
        if (!current("assignments", op)) return;
        end("assignments", op);
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [begin, current, end, reloadAssignments],
  );

  const reloadOpLog = useCallback(
    async (reset = true) => {
      const op = ++ops.current.opLog;
      const after = reset ? 0 : stateRef.current.opLogAfter;
      try {
        const page = await invokeEngine("collab.opLog.list", {
          projectId: projectId(),
          afterSequence: after,
          limit: 50,
        });
        if (!current("opLog", op)) return;
        const cursor = nextOpLogAfterSequence(after, page.items);
        setState((s) => ({
          ...s,
          opLog: reset ? page.items : [...s.opLog, ...page.items],
          opLogAfter: cursor.nextAfter,
          opLogCanLoadMore: cursor.canLoadMore,
        }));
      } catch (error) {
        if (!current("opLog", op)) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [current],
  );

  const loadMoreOpLog = useCallback(async () => {
    if (!stateRef.current.opLogCanLoadMore) return;
    await reloadOpLog(false);
  }, [reloadOpLog]);

  useEffect(() => {
    if (!gateway.active) {
      stopPresence();
      return;
    }
    switch (gateway.section) {
      case "members":
        void reloadMembers();
        break;
      case "locks":
        void reloadLocks();
        break;
      case "presence":
        void reloadPresence();
        break;
      case "assignments":
        void reloadAssignments();
        break;
      case "opLog":
        void reloadOpLog(true);
        break;
      default:
        break;
    }
  }, [
    gateway.active,
    gateway.section,
    gateway.generation,
    gateway.context.projectId,
    reloadMembers,
    reloadLocks,
    reloadPresence,
    reloadAssignments,
    reloadOpLog,
    stopPresence,
  ]);

  return {
    state,
    invalidate,
    setActorId: (v) => setState((s) => ({ ...s, actorId: v })),
    setNewMemberId: (v) => setState((s) => ({ ...s, newMemberId: v })),
    setNewMemberRole: (v) => setState((s) => ({ ...s, newMemberRole: v })),
    setAssignee: (v) => setState((s) => ({ ...s, assigneeActorId: v })),
    setOrdinalRange: (start, end) =>
      setState((s) => ({ ...s, ordinalStart: start, ordinalEnd: end })),
    reloadMembers,
    addMember,
    removeMember,
    reloadLocks,
    acquireLock,
    releaseLock,
    heartbeatLock,
    reloadPresence,
    startPresence,
    stopPresence,
    reloadAssignments,
    createAssignment,
    completeAssignment,
    reloadOpLog,
    loadMoreOpLog,
  };
}
