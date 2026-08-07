import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Document,
  GlobalSearchHit,
  ProjectSnapshot,
  QaIssue,
  Segment,
  SegmentCounts,
  SegmentEditorRow,
} from "@translunar/contracts";

import { BrandMark } from "./BrandMark";
import {
  bootstrapAppearance,
  cycleDensity,
  readDensityPreference,
  readUiScale,
  setDensityPreference,
  setUiScale,
  type DensityPreference,
} from "./components/system/appearance-controller";
import {
  DEFAULT_SETTINGS_SECTION,
  normalizeSettingsSection,
  type SettingsSectionId,
} from "./components/system/settings-presenters";
import {
  bootstrapTheme,
  setThemePreference,
  subscribeSystemTheme,
  toggleLightDark,
  type ThemePreference,
} from "./components/system/theme-controller";
import { CommandPalette, type Command } from "./components/shell/CommandPalette";
import { Shell } from "./components/shell/Shell";
import {
  DraftRecoveryDialog,
  type RecoverableDraft,
} from "./DraftRecoveryDialog";
import { shouldIgnoreKey } from "./hooks/useComposition";
import { useViewTransition } from "./hooks/useViewTransition";
import { useLocale } from "./i18n/LocaleProvider";
import { ProductSettingsPage } from "./ProductSettingsPage";
import { ProjectHome } from "./ProjectHome";
import { parseStoredSession, type StoredSession } from "./session-utils";
import { SetupView } from "./SetupView";
import {
  SURFACE_LABEL,
  SURFACE_ORDER,
  type AppSurface,
} from "./surface-types";
import { TutorialOverlay } from "./TutorialOverlay";
import { Workbench } from "./Workbench";
import { WorkspacePage } from "./WorkbenchPages";
import type { TutorialState } from "../shared/product-shell";
import { defaultTutorialState } from "../shared/product-shell";

const SESSION_KEY = "translunar.active-workspace.v1";

interface WorkbenchStatus {
  counts: SegmentCounts;
  saveState: "saved" | "saving" | "error";
  activeOrdinal: number | undefined;
}

interface WorkspaceData {
  snapshot: ProjectSnapshot;
  document: Document;
  segments: Segment[];
  editorRows: SegmentEditorRow[];
  issues: QaIssue[];
}

type AppMode = "home" | "setup" | "workspace";

export function App() {
  const { t, ready } = useLocale();
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [mode, setMode] = useState<AppMode>("home");
  const [surface, setSurface] = useState<AppSurface>("workbench");
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>(
    DEFAULT_SETTINGS_SECTION,
  );
  const [tutorial, setTutorial] = useState<TutorialState | null>(null);
  const [engineBanner, setEngineBanner] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<RecoverableDraft[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [spineHidden, setSpineHidden] = useState(false);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(
    () => {
      const { preference } = bootstrapTheme();
      return preference;
    },
  );
  const [density, setDensityState] = useState<DensityPreference>(() => {
    bootstrapAppearance();
    return readDensityPreference();
  });
  const [uiScale, setUiScaleState] = useState<number>(() => readUiScale());
  const [workbenchStatus, setWorkbenchStatus] =
    useState<WorkbenchStatus | null>(null);
  const runTransition = useViewTransition();
  // 工作台注册的"离开前落盘"守卫（见 Workbench 的 onRegisterLeaveGuard）
  const leaveGuardRef = useRef<(() => Promise<void>) | null>(null);
  const registerLeaveGuard = useCallback(
    (guard: (() => Promise<void>) | null) => {
      leaveGuardRef.current = guard;
    },
    [],
  );
  const flushBeforeLeave = useCallback(async () => {
    const guard = leaveGuardRef.current;
    if (!guard) return;
    try {
      await guard();
    } catch {
      // 落盘失败不阻断导航：草稿仍在 journal 里，可由恢复对话框接手
    }
  }, []);

  const applyThemePreference = useCallback((preference: ThemePreference) => {
    setThemePreference(preference);
    setThemePreferenceState(preference);
  }, []);

  const applyDensity = useCallback((next: DensityPreference) => {
    setDensityPreference(next);
    setDensityState(next);
  }, []);

  const applyUiScale = useCallback((next: number) => {
    const value = setUiScale(next);
    setUiScaleState(value);
  }, []);

  const openSettings = useCallback(
    async (section?: SettingsSectionId | string) => {
      if (mode === "workspace") {
        await flushBeforeLeave();
      }
      setSettingsSection(normalizeSettingsSection(section));
      setSettingsOpen(true);
    },
    [flushBeforeLeave, mode],
  );

  // Follow OS when preference is system
  useEffect(() => {
    if (themePreference !== "system") return;
    return subscribeSystemTheme(() => {
      setThemePreference("system");
    });
  }, [themePreference]);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const session = readSession();
      if (!session) {
        if (!cancelled) setRestoring(false);
        return;
      }
      try {
        const data = await loadWorkspace(
          t,
          session.projectId,
          session.documentId,
        );
        if (!cancelled) {
          setWorkspace(data);
          setMode("workspace");
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
        if (!cancelled) setMode("home");
      } finally {
        if (!cancelled) setRestoring(false);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    void window.translunar
      .getTutorialState()
      .then(setTutorial)
      .catch(() => {
        setTutorial(defaultTutorialState());
      });
  }, []);

  useEffect(() => {
    const unsubscribeStatus = window.translunar.onEngineStatus((payload) => {
      if (payload.type === "reconnecting") {
        setEngineBanner(t("status.engineReconnecting"));
      } else if (payload.type === "reconnected") {
        setEngineBanner(t("status.engineReconnected"));
      } else if (payload.type === "failed") {
        setEngineBanner(t("error.engineExited"));
      }
    });
    const unsubscribeReconnect = window.translunar.onEngineReconnected(() => {
      void (async () => {
        setEngineBanner(t("status.engineReconnected"));
        if (!workspace) {
          // No active workspace: journal inspection does not depend on
          // project/document/segment projections.
          try {
            const recoveredDrafts = await inspectDrafts(null);
            setDrafts(recoveredDrafts);
          } catch {
            setDrafts([]);
          }
          setTimeout(() => setEngineBanner(null), 4_000);
          return;
        }
        try {
          // Authoritative project/document/segment/QA reload must succeed
          // before any journal revision comparison.
          const data = await loadWorkspace(
            t,
            workspace.snapshot.project.id,
            workspace.document.id,
          );
          setWorkspace(data);
          const recoveredDrafts = await inspectDrafts(data);
          setDrafts(recoveredDrafts);
          setTimeout(() => setEngineBanner(null), 4_000);
        } catch {
          // Do not classify drafts against pre-crash revisions. Keep a
          // recoverable error banner (Engine is already reconnected; only
          // authoritative workspace reload failed).
          setDrafts([]);
          setEngineBanner(t("error.generic"));
        }
      })();
    });
    return () => {
      unsubscribeStatus();
      unsubscribeReconnect();
    };
  }, [t, workspace]);

  useEffect(() => {
    void inspectDrafts(workspace)
      .then(setDrafts)
      .catch(() => setDrafts([]));
  }, [workspace?.document.id, workspace?.snapshot.project.id]);

  const openWorkspace = async (
    projectId: string,
    documentId?: string,
    segmentId?: string,
    segmentOrdinal?: number,
  ) => {
    const data = await loadWorkspace(t, projectId, documentId, segmentOrdinal);
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ projectId, documentId: data.document.id }),
    );
    setWorkspace(data);
    setMode("workspace");
    setSurface("workbench");
    setFocusSegmentId(segmentId ?? null);
  };

  const returnHome = () => {
    // 返回项目列表同样要先落盘未保存草稿
    void flushBeforeLeave().finally(() => {
      localStorage.removeItem(SESSION_KEY);
      setWorkspace(null);
      setWorkbenchStatus(null);
      setMode("home");
      setSurface("workbench");
      setFocusSegmentId(null);
    });
  };

  const refreshWorkspace = async () => {
    if (!workspace) return;
    const data = await loadWorkspace(
      t,
      workspace.snapshot.project.id,
      workspace.document.id,
    );
    setWorkspace(data);
  };

  // navigateFromWorkbench 已被 goToSurface 取代（带 View Transition + 落盘守卫）

  const openSegment = (segmentId: string) => {
    setFocusSegmentId(segmentId);
    setSurface("workbench");
  };

  const openExample = useCallback(async () => {
    const result = await window.translunar.openExampleProject();
    if (!result.ok || !result.projectId) {
      throw new Error(result.message ?? t("error.generic"));
    }
    await openWorkspace(result.projectId, result.documentId);
  }, [t]);

  const persistTutorial = useCallback(
    async (next: {
      step: TutorialState["step"];
      skipped: boolean;
      completed: boolean;
    }) => {
      const saved = await window.translunar.updateTutorialState(next);
      setTutorial(saved);
    },
    [],
  );

  const goToSurface = useCallback(
    (next: AppSurface) => {
      if (!workspace) return;
      if (next === surface) return;
      runTransition("surface", async () => {
        // 离开工作台前先把未保存草稿落盘（静默，不拦截）
        await flushBeforeLeave();
        if (next === "workbench") {
          setSurface("workbench");
          return;
        }
        const data = await loadWorkspace(
          t,
          workspace.snapshot.project.id,
          workspace.document.id,
        );
        setWorkspace(data);
        setSurface(next);
      });
    },
    [flushBeforeLeave, runTransition, surface, t, workspace],
  );

  // 全局快捷键：Ctrl+1..6 Surface · Ctrl+K 命令面板 · Ctrl+\ 收起 Spine
  // Ctrl+Alt+, 设置 · Ctrl+Alt+[ / ] 密度循环
  // 第一行必须是组合态守卫（07-interaction.md §3.2）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKey(event)) return;

      // Ctrl+Alt+, open settings; Ctrl+Alt+[ / ] density
      if (event.ctrlKey && event.altKey && !event.metaKey) {
        if (event.key === "," || event.code === "Comma") {
          event.preventDefault();
          void openSettings();
          return;
        }
        if (event.key === "[" || event.code === "BracketLeft") {
          event.preventDefault();
          applyDensity(cycleDensity(density, -1));
          return;
        }
        if (event.key === "]" || event.code === "BracketRight") {
          event.preventDefault();
          applyDensity(cycleDensity(density, 1));
          return;
        }
      }

      if (!event.ctrlKey || event.altKey) return;

      if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === "\\") {
        event.preventDefault();
        setSpineHidden((hidden) => !hidden);
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 6) {
        const next = SURFACE_ORDER[digit - 1];
        if (next) {
          event.preventDefault();
          goToSurface(next);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyDensity, density, goToSurface, openSettings]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    SURFACE_ORDER.forEach((id, index) => {
      list.push({
        id: `surface:${id}`,
        label: SURFACE_LABEL[id],
        group: "跳转",
        meta: `Ctrl+${index + 1}`,
        run: () => goToSurface(id),
      });
    });

    if (workspace) {
      for (const doc of workspace.snapshot.documents) {
        list.push({
          id: `doc:${doc.id}`,
          label: doc.name,
          group: "文档",
          run: () => {
            void openWorkspace(workspace.snapshot.project.id, doc.id);
          },
        });
      }
    }

    list.push(
      {
        id: "action:settings",
        label: "设置",
        group: "动作",
        meta: "Ctrl+Alt+,",
        run: () => {
          void openSettings();
        },
      },
      {
        id: "action:settings-appearance",
        label: "设置 · 外观",
        group: "动作",
        run: () => {
          void openSettings("appearance");
        },
      },
      {
        id: "action:theme",
        label:
          themePreference === "dark"
            ? "切换到浅色主题"
            : themePreference === "light"
              ? "切换到深色主题"
              : "切换主题（跟随系统）",
        group: "动作",
        run: () => applyThemePreference(toggleLightDark(themePreference)),
      },
      {
        id: "action:spine",
        label: spineHidden ? "显示导航脊柱" : "隐藏导航脊柱",
        group: "动作",
        meta: "Ctrl+\\",
        run: () => setSpineHidden(!spineHidden),
      },
      {
        id: "action:home",
        label: "返回项目列表",
        group: "动作",
        run: returnHome,
      },
    );

    return list;
  }, [
    applyThemePreference,
    goToSurface,
    openSettings,
    spineHidden,
    themePreference,
    workspace,
  ]);

  if (!ready || restoring) {
    return (
      <div className="boot-screen" role="status">
        <BrandMark />
        <span>{t("loading.workspace")}</span>
      </div>
    );
  }

  const showTutorial = tutorial && !tutorial.completed && !tutorial.skipped;

  const shellChrome = (
    <>
      {engineBanner ? (
        <div className="engine-status-banner" role="status">
          {engineBanner}
          <button
            type="button"
            className="button ghost"
            onClick={() => void window.translunar.restartEngine()}
          >
            {t("action.retry")}
          </button>
        </div>
      ) : null}
      {showTutorial && tutorial ? (
        <TutorialOverlay
          initial={tutorial}
          onChange={(state) => {
            void persistTutorial(state);
          }}
          onOpenExample={() => {
            void openExample().catch(() => undefined);
          }}
        />
      ) : null}
      {drafts.length > 0 ? (
        <DraftRecoveryDialog
          drafts={drafts}
          onClose={() => setDrafts([])}
          onCopy={async (draft) => {
            await navigator.clipboard.writeText(draft.targetText);
          }}
          onCopyMany={async (text) => {
            await navigator.clipboard.writeText(text);
          }}
          onDiscard={async (draft) => {
            await window.translunar.clearDraftJournal([draft.segmentId]);
            setDrafts((current) =>
              current.filter((item) => item.segmentId !== draft.segmentId),
            );
          }}
          onDiscardAll={async (all) => {
            await window.translunar.clearDraftJournal(
              all.map((d) => d.segmentId),
            );
            setDrafts([]);
          }}
          onRestore={async (draft) => {
            if (draft.stale || draft.unverified) return;
            await window.translunar.invoke("segment.updateTarget", {
              segmentId: draft.segmentId,
              targetText: draft.targetText,
              expectedRevision: draft.expectedRevision,
            });
            await window.translunar.clearDraftJournal([draft.segmentId]);
            setDrafts((current) =>
              current.filter((item) => item.segmentId !== draft.segmentId),
            );
            await refreshWorkspace();
          }}
        />
      ) : null}
    </>
  );

  const inWorkspace = mode === "workspace" && workspace !== null;

  // 工作台报上来的实时计数优先；未打开工作台时退回快照计数
  const shellCounts = inWorkspace
    ? (workbenchStatus?.counts ?? workspace.snapshot.counts)
    : undefined;

  const surfaceContent = (() => {
    if (settingsOpen) {
      return (
        <ProductSettingsPage
          project={workspace?.snapshot.project ?? null}
          section={settingsSection}
          onSectionChange={setSettingsSection}
          onClose={() => setSettingsOpen(false)}
          onOpenExample={() => {
            void openExample().catch(() => undefined);
            setSettingsOpen(false);
          }}
          onRestartTutorial={() => {
            void persistTutorial({
              step: "welcome",
              skipped: false,
              completed: false,
            });
            setSettingsOpen(false);
          }}
          onWorkspaceReloaded={() => {
            void refreshWorkspace().catch(() => undefined);
          }}
          themePreference={themePreference}
          onThemePreferenceChange={applyThemePreference}
          density={density}
          onDensityChange={applyDensity}
          uiScale={uiScale}
          onUiScaleChange={applyUiScale}
        />
      );
    }

    if (!inWorkspace) {
      return mode === "setup" ? (
        <SetupView onCreated={openWorkspace} onCancel={() => setMode("home")} />
      ) : (
        <ProjectHome onCreate={() => setMode("setup")} onOpen={openWorkspace} />
      );
    }

    if (surface !== "workbench") {
      return (
        <WorkspacePage
          surface={surface}
          snapshot={workspace.snapshot}
          document={workspace.document}
          segments={workspace.segments}
          issues={workspace.issues}
          onNavigate={goToSurface}
          onRefresh={refreshWorkspace}
          onOpenSegment={openSegment}
          onOpenDocument={(documentId) =>
            openWorkspace(workspace.snapshot.project.id, documentId)
          }
          onOpenProject={openWorkspace}
          onReturnHome={returnHome}
          onOpenSettings={() => {
            void openSettings();
          }}
        />
      );
    }

    return (
      <Workbench
        initialWorkspace={workspace}
        onOpenGlobalSearchHit={(hit: GlobalSearchHit) =>
          openWorkspace(
            hit.projectId,
            hit.documentId ?? undefined,
            hit.segmentId ?? undefined,
            hit.segmentOrdinal ?? undefined,
          )
        }
        onOpenDocument={(documentId) =>
          openWorkspace(workspace.snapshot.project.id, documentId)
        }
        key={workspace.document.id}
        focusSegmentId={focusSegmentId}
        onStatusChange={setWorkbenchStatus}
        onRegisterLeaveGuard={registerLeaveGuard}
        themePreference={themePreference}
        onThemePreferenceChange={applyThemePreference}
      />
    );
  })();

  return (
    <>
      {shellChrome}
      <Shell
        surface={surface}
        hasProject={inWorkspace}
        projectName={workspace?.snapshot.project.name}
        counts={shellCounts}
        saveState={workbenchStatus?.saveState}
        activeOrdinal={workbenchStatus?.activeOrdinal}
        spineHidden={spineHidden}
        onSurfaceChange={goToSurface}
        onGoHome={returnHome}
        onCommandPalette={() => setPaletteOpen(true)}
        onSettingsOpen={() => {
          void openSettings();
        }}
        onThemeToggle={() =>
          applyThemePreference(toggleLightDark(themePreference))
        }
      >
        {surfaceContent}
      </Shell>
      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  );
}

async function loadWorkspace(
  translate: ReturnType<typeof useLocale>["t"],
  projectId: string,
  documentId?: string,
  focusSegmentOrdinal?: number,
): Promise<WorkspaceData> {
  const snapshot = await window.translunar.invoke("project.get", { projectId });
  if (snapshot.project.lifecycle === "trash") {
    throw new Error(translate("error.projectInRecycleBin"));
  }
  const document =
    snapshot.documents.find((item) => item.id === documentId) ??
    snapshot.documents[0];
  if (!document) throw new Error(translate("error.projectNoDocuments"));
  const offset =
    focusSegmentOrdinal === undefined
      ? 0
      : Math.max(0, focusSegmentOrdinal - 20);
  const [page, qa] = await Promise.all([
    window.translunar.invoke("segment.editor.list", {
      documentId: document.id,
      query: "",
      field: "both",
      filter: "all",
      sort: "ordinal",
      descending: false,
      offset,
      limit: 80,
      includeContext: true,
    }),
    window.translunar.invoke("qa.list", {
      projectId,
      documentId: document.id,
      offset: 0,
      limit: 200,
    }),
  ]);
  return {
    snapshot,
    document,
    segments: page.items.map((row) => row.segment),
    editorRows: page.items,
    issues: qa.issues,
  };
}

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const session = parseStoredSession(raw);
    if (raw && !session) {
      localStorage.removeItem(SESSION_KEY);
    }
    return session;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

async function inspectDrafts(
  workspace: WorkspaceData | null | undefined,
): Promise<RecoverableDraft[]> {
  const journal = await window.translunar.getDraftJournal();
  if (journal.records.length === 0) return [];
  const relevant = workspace
    ? journal.records.filter(
        (item) =>
          item.projectId === workspace.snapshot.project.id &&
          item.documentId === workspace.document.id,
      )
    : journal.records;
  if (relevant.length === 0) return [];
  const byId = new Map(
    (workspace?.segments ?? []).map((segment) => [segment.id, segment]),
  );
  if (workspace) {
    const missingIds = new Set(
      relevant
        .map((record) => record.segmentId)
        .filter((segmentId) => !byId.has(segmentId)),
    );
    let offset = 0;
    while (missingIds.size > 0) {
      const page = await window.translunar.invoke("segment.list", {
        documentId: workspace.document.id,
        offset,
        limit: 200,
      });
      for (const segment of page.items) {
        if (!missingIds.has(segment.id)) continue;
        byId.set(segment.id, segment);
        missingIds.delete(segment.id);
      }
      offset += page.items.length;
      if (page.items.length === 0 || offset >= page.total) break;
    }
  }
  return relevant.map((record) => {
    const current = byId.get(record.segmentId);
    // Missing current (no workspace / list miss) → unverified, not stale.
    if (current === undefined) {
      return {
        ...record,
        stale: false,
        unverified: true,
      };
    }
    const stale = current.revision !== record.expectedRevision;
    return {
      ...record,
      stale,
      currentRevision: current.revision,
      currentTargetText: current.targetText,
    };
  });
}
