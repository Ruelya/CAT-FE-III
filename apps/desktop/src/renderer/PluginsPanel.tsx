import { useCallback, useEffect, useState } from "react";
import type { PluginSummary } from "@translunar/contracts";
import { Puzzle, RefreshCw } from "lucide-react";

import { formatError } from "./workbench-utils";

import "./PluginsPanel.css";

interface PluginsPanelProps {
  onRefresh(): Promise<void>;
}

export function PluginsPanel({ onRefresh }: PluginsPanelProps) {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await window.translunar.invoke("plugin.list", {
        offset: 0,
        limit: 100,
      });
      setPlugins(page.items);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async () => {
    setError(null);
    try {
      const sourcePath = await window.translunar.selectPluginPackage();
      if (!sourcePath) return;
      setBusyId("install");
      await window.translunar.invoke("plugin.install", {
        sourcePath,
        grantRequested: true,
        actor: "desktop",
        reason: "install from Plugins panel",
      });
      await load();
      await onRefresh();
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusyId(null);
    }
  };

  const mutate = async (
    pluginId: string,
    method: "plugin.enable" | "plugin.disable" | "plugin.uninstall",
  ) => {
    setBusyId(pluginId);
    setError(null);
    try {
      await window.translunar.invoke(method, {
        pluginId,
        actor: "desktop",
        reason: `${method} from Plugins panel`,
      });
      await load();
      await onRefresh();
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="plugins-panel" aria-labelledby="plugins-heading">
      <header className="plugins-panel__header">
        <div>
          <h2 id="plugins-heading">
            <Puzzle size={16} aria-hidden /> Plugins
          </h2>
          <p className="plugins-panel__lede">
            Install local process plugins, grant requested permissions, and
            enable filter contributions.
          </p>
        </div>
        <div className="plugins-panel__actions">
          <button type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} aria-hidden /> Refresh
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void install()}
            disabled={busyId !== null}
          >
            Install package…
          </button>
        </div>
      </header>

      {error ? (
        <p className="plugins-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="plugins-panel__empty">Loading plugins…</p>
      ) : plugins.length === 0 ? (
        <p className="plugins-panel__empty">
          No plugins installed. Choose a package directory that contains
          manifest.json.
        </p>
      ) : (
        <ul className="plugins-panel__list">
          {plugins.map((plugin) => (
            <li key={plugin.id} className="plugins-panel__item">
              <div>
                <strong>{plugin.displayName}</strong>
                <div className="plugins-panel__meta">
                  <span>{plugin.id}</span>
                  <span>v{plugin.version}</span>
                  <span data-status={plugin.status}>{plugin.status}</span>
                </div>
                <div className="plugins-panel__meta">
                  permissions: {plugin.grantedPermissions.join(", ") || "none"}
                </div>
                {plugin.lastError ? (
                  <p className="plugins-panel__error">{plugin.lastError}</p>
                ) : null}
              </div>
              <div className="plugins-panel__item-actions">
                {plugin.status === "enabled" ? (
                  <button
                    type="button"
                    disabled={busyId === plugin.id}
                    onClick={() => void mutate(plugin.id, "plugin.disable")}
                  >
                    Disable
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === plugin.id}
                    onClick={() => void mutate(plugin.id, "plugin.enable")}
                  >
                    Enable
                  </button>
                )}
                <button
                  type="button"
                  className="danger"
                  disabled={busyId === plugin.id}
                  onClick={() => void mutate(plugin.id, "plugin.uninstall")}
                >
                  Uninstall
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
