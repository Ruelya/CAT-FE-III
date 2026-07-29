import { useCallback, useEffect, useMemo, useState } from "react";
import type { PluginUiPanelView } from "@translunar/contracts";
import { PanelRight, RefreshCw, X } from "lucide-react";

import { PluginPanelHost } from "./PluginPanelHost";
import { useLocale } from "./i18n/LocaleProvider";

export type WorkbenchPanelPlacement =
  "editorSidebar" | "assistantSidebar" | "bottomPanel";

interface PluginWorkbenchPanelsProps {
  /** Closed placement this host mounts. Required for real region mounting. */
  placement: WorkbenchPanelPlacement;
  /** Active project for Engine-owned bridge derivation (identifiers only). */
  projectId?: string;
  /** Active segment for Engine-owned bridge derivation (identifiers only). */
  segmentId?: string;
}

/**
 * Mounts Engine-generated plugin panels for one declared workbench placement.
 *
 * Open policy: tabs are always listed for available contributions, but the
 * surface opens only via explicit tab activation (or keyboard). Close remains
 * closed across inventory refresh; detach removes closed keys automatically.
 */
export function PluginWorkbenchPanels({
  placement,
  projectId,
  segmentId,
}: PluginWorkbenchPanelsProps) {
  const { t } = useLocale();
  const [panels, setPanels] = useState<PluginUiPanelView[]>([]);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const page = await window.translunar.invoke("plugin.uiPanel.list", {});
      const items = page.items
        .filter((panel) => panel.descriptor.placement === placement)
        .filter((panel) => panel.state === "active");
      setPanels(items);
      const keys = new Set(items.map(panelKey));
      // Prune detached generations only — never auto-open or reselect first.
      setOpenKeys((current) => current.filter((key) => keys.has(key)));
      setSelectedKey((current) =>
        current && keys.has(current) ? current : null,
      );
    } catch (cause) {
      setPanels([]);
      setOpenKeys([]);
      setSelectedKey(null);
      setError(
        cause instanceof Error
          ? cause.message
          : t("plugins.workbenchPanels.failure"),
      );
    } finally {
      setLoading(false);
    }
  }, [placement, t]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selected = useMemo(
    () => panels.find((panel) => panelKey(panel) === selectedKey),
    [panels, selectedKey],
  );

  const openPanel = (panel: PluginUiPanelView) => {
    const key = panelKey(panel);
    setOpenKeys((current) =>
      current.includes(key) ? current : [...current, key],
    );
    setSelectedKey(key);
  };

  const closePanel = (key: string) => {
    setOpenKeys((current) => current.filter((item) => item !== key));
    setSelectedKey((current) => (current === key ? null : current));
  };

  // No inventory and not loading: collapse completely (no blank chrome).
  if (!loading && !error && panels.length === 0) {
    return null;
  }

  const surfaceOpen =
    selected !== undefined && openKeys.includes(panelKey(selected));

  return (
    <section
      className={`plugin-workbench-panels plugin-workbench-panels--${placement}${
        surfaceOpen ? " is-open" : ""
      }`}
      aria-label={`${t("plugins.workbenchPanels.aria")} (${placement})`}
      data-placement={placement}
      data-open={surfaceOpen ? "true" : "false"}
    >
      <header>
        <div>
          <PanelRight size={14} aria-hidden="true" />
          <strong>{t("plugins.workbenchPanels.title")}</strong>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => void refresh()}
          aria-label={t("plugins.workbenchPanels.refresh")}
          title={t("plugins.workbenchPanels.refresh")}
        >
          <RefreshCw size={13} />
        </button>
      </header>
      {panels.length ? (
        <div className="plugin-workbench-panels__tabs" role="tablist">
          {panels.map((panel) => {
            const key = panelKey(panel);
            const open = openKeys.includes(key) && key === selectedKey;
            return (
              <button
                key={key}
                id={`plugin-panel-tab-${placement}-${key}`}
                type="button"
                role="tab"
                aria-selected={open}
                aria-controls={`plugin-panel-surface-${placement}-${key}`}
                onClick={() => {
                  if (open) closePanel(key);
                  else openPanel(panel);
                }}
                onKeyDown={(event) => {
                  const current = panels.findIndex(
                    (candidate) => panelKey(candidate) === key,
                  );
                  const next = nextTabIndex(event.key, current, panels.length);
                  if (next === null) return;
                  event.preventDefault();
                  const nextPanel = panels[next];
                  if (!nextPanel) return;
                  openPanel(nextPanel);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                    .item(next)
                    ?.focus();
                }}
              >
                <span className="plugin-workbench-panels__tab-label">
                  {panel.descriptor.label}
                </span>
                <small className="plugin-workbench-panels__tab-meta">
                  {panel.owner.pluginId} · {panel.descriptor.version}
                </small>
              </button>
            );
          })}
        </div>
      ) : null}
      {surfaceOpen && selected ? (
        <div
          id={`plugin-panel-surface-${placement}-${panelKey(selected)}`}
          className="plugin-workbench-panels__surface"
          role="tabpanel"
          aria-labelledby={`plugin-panel-tab-${placement}-${panelKey(selected)}`}
          tabIndex={0}
        >
          <div className="plugin-workbench-panels__provenance">
            <span>{selected.owner.pluginId}</span>
            <span>{selected.descriptor.version}</span>
            <span data-state={selected.state}>{selected.state}</span>
            <button
              type="button"
              className="icon-button"
              onClick={() => closePanel(panelKey(selected))}
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <X size={12} />
            </button>
          </div>
          <PluginPanelHost
            pluginId={selected.owner.pluginId}
            pluginName={selected.descriptor.displayName}
            contributionId={selected.owner.contributionId}
            contributionName={selected.descriptor.displayName}
            revision={selected.owner.activationRevision}
            versionId={selected.owner.versionId}
            allowedMethods={bridgeMethods(selected.descriptor.methods)}
            {...(projectId ? { projectId } : {})}
            {...(segmentId ? { segmentId } : {})}
            onClose={() => closePanel(panelKey(selected))}
          />
        </div>
      ) : loading ? (
        <p role="status" className="plugin-workbench-panels__status">
          {t("plugins.workbenchPanels.loading")}
        </p>
      ) : error ? (
        <p role="alert" className="plugin-workbench-panels__status">
          {error}
        </p>
      ) : panels.length ? (
        <p role="status" className="plugin-workbench-panels__status">
          {t("plugins.workbenchPanels.closedHint")}
        </p>
      ) : null}
    </section>
  );
}

function panelKey(panel: PluginUiPanelView): string {
  return `${panel.owner.pluginId}:${panel.owner.versionId}:${panel.owner.activationRevision}:${panel.owner.contributionId}`;
}

function bridgeMethods(
  methods: PluginUiPanelView["descriptor"]["methods"] | undefined,
): Array<
  | "panel.context"
  | "panel.activeSelection"
  | "panel.projectContext"
  | "panel.proposeReplacement"
> {
  const declared = methods?.length ? methods : ["panelContext"];
  const mapped = declared
    .map((method) => {
      switch (method) {
        case "panelContext":
          return "panel.context" as const;
        case "activeSelection":
          return "panel.activeSelection" as const;
        case "projectContext":
          return "panel.projectContext" as const;
        case "proposeReplacement":
          return "panel.proposeReplacement" as const;
        default:
          return null;
      }
    })
    .filter((method): method is NonNullable<typeof method> => method !== null);
  return mapped.length ? mapped : ["panel.context"];
}

export function nextTabIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (count === 0 || current < 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp")
    return (current - 1 + count) % count;
  return null;
}
