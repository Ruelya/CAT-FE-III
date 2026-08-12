import { formatUiError } from "../lib/errors";
import type { CollaborationSection } from "../state/app-state";
import {
  canAcquireLock,
  formatLocalCollabLabel,
  inspectOpPayload,
} from "../state/collab-view";
import type { CollaborationControllerApi } from "../state/use-collaboration-controller";
import type { P4ProjectContext } from "../state/p4-route-context";
import { SectionNav } from "../shell/SectionNav";

export interface CollaborationProps {
  collab: CollaborationControllerApi;
  section: CollaborationSection;
  context: P4ProjectContext;
  disabled?: boolean;
  onBack: () => void;
  onSectionChange: (section: CollaborationSection) => void;
}

const SECTIONS: Array<{ id: CollaborationSection; label: string }> = [
  { id: "members", label: "Members" },
  { id: "locks", label: "Locks" },
  { id: "presence", label: "Presence" },
  { id: "assignments", label: "Assignments" },
  { id: "opLog", label: "Op log" },
];

export function Collaboration({
  collab,
  section,
  context,
  disabled,
  onBack,
  onSectionChange,
}: CollaborationProps) {
  const { state } = collab;
  const busy = disabled === true || state.mutationPending;

  return (
    <section className="surface p4-surface" data-testid="collaboration">
      <div className="surface__masthead">
        <h1 className="surface__title">
          {formatLocalCollabLabel()} · {context.projectName}
        </h1>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={onBack}
          data-testid="collab-back"
        >
          Back
        </button>
      </div>

      <SectionNav
        label="Collaboration sections"
        items={SECTIONS.map((s) => ({
          id: s.id,
          label: s.label,
          testId: `collab-tab-${s.id}`,
        }))}
        current={section}
        disabled={busy}
        onSelect={onSectionChange}
      />

      {state.error ? (
        <p className="status status--error" role="alert">
          {formatUiError(state.error)}
        </p>
      ) : null}

      <div className="p4-toolbar">
        <label className="field field--inline">
          <span>Actor</span>
          <input
            value={state.actorId}
            disabled={busy}
            onChange={(e) => collab.setActorId(e.target.value)}
            data-testid="collab-actor"
          />
        </label>
      </div>

      {section === "members" ? (
        <div className="p4-panel" data-testid="collab-members">
          <div className="p4-toolbar">
            <input
              value={state.newMemberId}
              disabled={busy}
              placeholder="Actor id"
              onChange={(e) => collab.setNewMemberId(e.target.value)}
              data-testid="collab-member-id"
            />
            <select
              value={state.newMemberRole}
              disabled={busy}
              onChange={(e) =>
                collab.setNewMemberRole(e.target.value as "owner" | "member")
              }
            >
              <option value="member">member</option>
              <option value="owner">owner</option>
            </select>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy}
              onClick={() => void collab.addMember()}
              data-testid="collab-member-add"
            >
              Add
            </button>
          </div>
          {state.members.length === 0 ? (
            <p className="status">Empty</p>
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Actor</th>
                  <th>Role</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.members.map((m) => (
                  <tr key={m.actorId}>
                    <td className="p4-wrap">{m.actorId}</td>
                    <td>{m.role}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={busy}
                        onClick={() => void collab.removeMember(m.actorId)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {section === "locks" ? (
        <div className="p4-panel" data-testid="collab-locks">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={
              busy ||
              !canAcquireLock({
                projectId: context.projectId,
                documentId: context.documentId,
                segmentId: context.activeSegmentId,
              })
            }
            onClick={() => void collab.acquireLock()}
            data-testid="collab-lock-acquire"
          >
            Acquire
          </button>
          {state.locks.length === 0 ? (
            <p className="status">Empty</p>
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Segment</th>
                  <th>Holder</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.locks.map((l) => (
                  <tr key={`${l.segmentId}:${l.actorId}`}>
                    <td className="p4-wrap">{l.segmentId}</td>
                    <td className="p4-wrap">{l.actorId}</td>
                    <td>{new Date(l.expiresAtMs).toISOString()}</td>
                    <td className="p4-row-actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => void collab.heartbeatLock(l.segmentId)}
                      >
                        Heartbeat
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={busy}
                        onClick={() => void collab.releaseLock(l.segmentId)}
                      >
                        Release
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {section === "presence" ? (
        <div className="p4-panel" data-testid="collab-presence">
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || state.presenceActive}
              onClick={() => void collab.startPresence()}
              data-testid="collab-presence-start"
            >
              Start presence
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy || !state.presenceActive}
              onClick={() => collab.stopPresence()}
              data-testid="collab-presence-stop"
            >
              Stop
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void collab.reloadPresence()}
            >
              Refresh
            </button>
          </div>
          {state.presence.length === 0 ? (
            <p className="status">Empty</p>
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Actor</th>
                  <th>Document</th>
                  <th>Segment</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {state.presence.map((p) => (
                  <tr key={`${p.actorId}:${p.updatedAtMs}`}>
                    <td className="p4-wrap">{p.actorId}</td>
                    <td className="p4-wrap">{p.documentId ?? "-"}</td>
                    <td className="p4-wrap">{p.segmentId ?? "-"}</td>
                    <td>{new Date(p.expiresAtMs).toISOString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {section === "assignments" ? (
        <div className="p4-panel" data-testid="collab-assignments">
          <div className="p4-form">
            <label className="field">
              <span>Assignee</span>
              <input
                value={state.assigneeActorId}
                disabled={busy}
                onChange={(e) => collab.setAssignee(e.target.value)}
                data-testid="collab-assignee"
              />
            </label>
            <label className="field">
              <span>Ordinal start</span>
              <input
                type="number"
                value={state.ordinalStart}
                disabled={busy}
                onChange={(e) =>
                  collab.setOrdinalRange(
                    Number(e.target.value),
                    state.ordinalEnd,
                  )
                }
              />
            </label>
            <label className="field">
              <span>Ordinal end</span>
              <input
                type="number"
                value={state.ordinalEnd}
                disabled={busy}
                onChange={(e) =>
                  collab.setOrdinalRange(
                    state.ordinalStart,
                    Number(e.target.value),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !context.documentId}
              onClick={() => void collab.createAssignment()}
              data-testid="collab-assignment-create"
            >
              Create
            </button>
          </div>
          {state.assignments.length === 0 ? (
            <p className="status">Empty</p>
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Assignee</th>
                  <th>Range</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.assignments.map((a) => (
                  <tr key={a.id}>
                    <td className="p4-wrap">{a.assigneeActorId}</td>
                    <td>
                      {a.ordinalStart}-{a.ordinalEnd}
                    </td>
                    <td>{a.status}</td>
                    <td>
                      {a.status === "open" ? (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy}
                          onClick={() =>
                            void collab.completeAssignment(a.id, a.revision)
                          }
                        >
                          Complete
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {section === "opLog" ? (
        <div className="p4-panel" data-testid="collab-oplog">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={busy || !state.opLogCanLoadMore}
            onClick={() => void collab.loadMoreOpLog()}
            data-testid="collab-oplog-more"
          >
            Load more
          </button>
          {state.opLog.length === 0 ? (
            <p className="status">Empty</p>
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>Kind</th>
                  <th>Actor</th>
                  <th>Time</th>
                  <th>Payload</th>
                </tr>
              </thead>
              <tbody>
                {state.opLog.map((e) => (
                  <tr key={e.id}>
                    <td>{e.sequence}</td>
                    <td>{e.kind}</td>
                    <td className="p4-wrap">{e.actorId}</td>
                    <td>{new Date(e.createdAtMs).toISOString()}</td>
                    <td className="p4-wrap">
                      {inspectOpPayload(e.payload) ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </section>
  );
}
