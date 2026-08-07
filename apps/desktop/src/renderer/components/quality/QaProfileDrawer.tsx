import { useEffect, useState } from "react";
import type {
  QaField,
  QaProfile,
  QaProfileDefinition,
  QaRegexRule,
  QaSeverity,
} from "@translunar/contracts";
import { Plus, Trash2 } from "lucide-react";

import { formatError } from "../../workbench-utils";

const SEVERITIES: QaSeverity[] = ["error", "warning", "info"];

export interface QaProfileDrawerProps {
  profile: QaProfile;
  projectId: string;
  reviewRequired: boolean;
  busy: boolean;
  labels: {
    title: string;
    cloneProfile: string;
    customProfile: string;
    name: string;
    maxTargetChars: string;
    builtinImmutable: string;
    customRegex: string;
    addRule: string;
    label: string;
    field: string;
    severity: string;
    pattern: string;
    message: string;
    replacementHint: string;
    removeRule: string;
    cancel: string;
    save: string;
    clone: string;
    close: string;
    mandatoryReview: string;
    customRule: string;
    customPattern: string;
  };
  onClose(): void;
  onSaved(saved: QaProfile): Promise<void>;
  onReviewRequired(required: boolean): void;
}

export function QaProfileDrawer({
  profile,
  projectId,
  reviewRequired,
  busy: parentBusy,
  labels,
  onClose,
  onSaved,
  onReviewRequired,
}: QaProfileDrawerProps) {
  const [draft, setDraft] = useState<QaProfileDefinition>(() =>
    structuredClone(profile.definition),
  );
  const [name, setName] = useState(
    profile.builtIn ? `${profile.name} custom` : profile.name,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rules = draft.regexRules ?? [];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const updateRule = (index: number, patchValue: Partial<QaRegexRule>) =>
    setDraft((current) => ({
      ...current,
      regexRules: (current.regexRules ?? []).map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patchValue } : rule,
      ),
    }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = profile.builtIn
        ? await window.translunar.invoke("qa.profile.clone", {
            profileId: profile.id,
            ownerProjectId: projectId,
            name: name.trim(),
          })
        : await window.translunar.invoke("qa.profile.update", {
            profileId: profile.id,
            expectedRevision: profile.revision,
            name: name.trim(),
            definition: { ...draft, name: name.trim() },
          });
      await onSaved(saved);
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qa-drawer-backdrop" role="presentation" onClick={onClose}>
      <section
        className="qa-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qa-profile-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="micro">
              {profile.builtIn ? labels.cloneProfile : labels.customProfile}
            </span>
            <h2 id="qa-profile-title">{labels.title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={labels.close}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {error ? (
          <p className="surface-error" role="alert">
            {error}
          </p>
        ) : null}
        <label>
          {labels.name}
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label>
          {labels.maxTargetChars}
          <input
            type="number"
            min={1}
            value={draft.settings.maxTargetChars ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                settings: {
                  ...current.settings,
                  maxTargetChars: event.currentTarget.value
                    ? Number(event.currentTarget.value)
                    : null,
                },
              }))
            }
          />
        </label>
        <label className="qa-drawer__toggle">
          <input
            type="checkbox"
            checked={reviewRequired}
            disabled={parentBusy || busy}
            onChange={(event) =>
              onReviewRequired(event.currentTarget.checked)
            }
          />
          <span>{labels.mandatoryReview}</span>
        </label>
        {profile.builtIn ? (
          <p className="profile-note">{labels.builtinImmutable}</p>
        ) : (
          <>
            <div className="profile-rules-heading">
              <strong>{labels.customRegex}</strong>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    regexRules: [
                      ...(current.regexRules ?? []),
                      newRegexRule(
                        current.regexRules?.length ?? 0,
                        labels.customRule,
                        labels.customPattern,
                      ),
                    ],
                  }))
                }
              >
                <Plus size={13} aria-hidden="true" />
                {labels.addRule}
              </button>
            </div>
            <div className="profile-rules">
              {rules.map((rule, index) => (
                <article key={`${rule.id}-${index}`}>
                  <label>
                    ID
                    <input
                      value={rule.id}
                      onChange={(event) =>
                        updateRule(index, { id: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label>
                    {labels.label}
                    <input
                      value={rule.label}
                      onChange={(event) =>
                        updateRule(index, { label: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label>
                    {labels.field}
                    <select
                      value={rule.field}
                      onChange={(event) =>
                        updateRule(index, {
                          field: event.currentTarget.value as QaField,
                        })
                      }
                    >
                      <option value="source">source</option>
                      <option value="target">target</option>
                      <option value="both">both</option>
                    </select>
                  </label>
                  <label>
                    {labels.severity}
                    <select
                      value={rule.severity}
                      onChange={(event) =>
                        updateRule(index, {
                          severity: event.currentTarget.value as QaSeverity,
                        })
                      }
                    >
                      {SEVERITIES.map((severity) => (
                        <option key={severity}>{severity}</option>
                      ))}
                    </select>
                  </label>
                  <label className="wide">
                    {labels.pattern}
                    <input
                      value={rule.pattern}
                      onChange={(event) =>
                        updateRule(index, {
                          pattern: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                  <label className="wide">
                    {labels.message}
                    <input
                      value={rule.message}
                      onChange={(event) =>
                        updateRule(index, {
                          message: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                  <label className="wide">
                    {labels.replacementHint}
                    <input
                      value={rule.replacementHint ?? ""}
                      onChange={(event) =>
                        updateRule(index, {
                          replacementHint: event.currentTarget.value || null,
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="profile-remove-rule"
                    aria-label={labels.removeRule.replace(
                      "{label}",
                      rule.label,
                    )}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        regexRules: (current.regexRules ?? []).filter(
                          (_, ruleIndex) => ruleIndex !== index,
                        ),
                      }))
                    }
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
        <footer>
          <button type="button" className="button secondary" onClick={onClose}>
            {labels.cancel}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!name.trim() || busy}
            onClick={() => void save()}
          >
            {profile.builtIn ? labels.clone : labels.save}
          </button>
        </footer>
      </section>
    </div>
  );
}

function newRegexRule(
  index: number,
  label: string,
  message: string,
): QaRegexRule {
  return {
    id: `custom.rule.${index + 1}`,
    label,
    field: "target",
    pattern: "",
    severity: "warning",
    message,
    replacementHint: null,
  };
}
