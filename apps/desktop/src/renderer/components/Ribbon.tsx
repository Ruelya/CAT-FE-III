import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode, Ref } from "react";

import {
  IconArrowBackUp,
  IconArrowDown,
  IconArrowForwardUp,
  IconBolt,
  IconCheck,
  IconClipboardCheck,
  IconDatabase,
  IconDatabaseImport,
  IconDots,
  IconEye,
  IconFileExport,
  IconFileImport,
  IconFolders,
  IconListSearch,
  IconLock,
  IconLockOpen,
  IconReplace,
  IconSearch,
  IconVocabulary,
} from "@tabler/icons-react";

/**
 * Ribbon toolbar under the application menu: labeled icon groups that all
 * dispatch the exact same handlers as the menu commands and keyboard
 * chords — the ribbon never grows behavior of its own, and every button is
 * disabled honestly when its target state is missing (no document, busy).
 * Items that no longer fit the row collapse into the trailing 更多 menu
 * instead of scrolling.
 */
export interface RibbonProps {
  /** A document is open in the grid; document commands enable. */
  documentOpen: boolean;
  /** A long-running engine call is in flight; mutating commands lock. */
  busy: boolean;
  /**
   * A target editor textarea is mounted (the caret readout exists). The
   * 撤销/重做 buttons drive that editor's own undo stack, so without an
   * editor they disable — there is no application-level undo to fake.
   */
  editorActive: boolean;
  /** Live segment filter (the far-right search box, Ctrl+Shift+F). */
  filterQuery: string;
  filterInputRef: Ref<HTMLInputElement>;
  onFilterQueryChange: (value: string) => void;
  onCloseProject?: (() => void) | undefined;
  onOpenTmManage?: (() => void) | undefined;
  onUndo: () => void;
  onRedo: () => void;
  onImport: () => void;
  onExport: () => void;
  onConfirmSegment: () => void;
  /**
   * The active segment's stored lock flag (straight from Segment.locked);
   * flips the button between 锁定句段 and 解锁句段. Null with no selection —
   * the button then disables instead of guessing a direction.
   */
  activeSegmentLocked: boolean | null;
  onToggleLock: () => void;
  /** Applies TM match #1 to the active segment (same path as Ctrl+1). */
  onInsertTm: () => void;
  /** Inserts the first non-forbidden term hit at the editor caret. */
  onInsertTerm: () => void;
  onPretranslate: () => void;
  /** Summons the floating find widget (find row / replace row). */
  onOpenFind: () => void;
  onOpenReplace: () => void;
  /** Jumps to the next find match (same path as F4). */
  onFindNext: () => void;
  onConcordance: () => void;
  /** Runs document QA through the engine (same handler as the QA dock). */
  onRunQa: () => void;
  /** Toggles the bottom preview pane (same command as Ctrl+P). */
  onTogglePreview: () => void;
}

interface RibbonItem {
  id: string;
  group: string;
  label: string;
  title: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}

const ICON_PROPS = { size: 18, stroke: 1.75, "aria-hidden": true } as const;

/** Splits the visible run into consecutive same-group blocks, in order. */
function groupRuns(
  items: readonly RibbonItem[],
): { group: string; items: RibbonItem[] }[] {
  const runs: { group: string; items: RibbonItem[] }[] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (last && last.group === item.group) {
      last.items.push(item);
    } else {
      runs.push({ group: item.group, items: [item] });
    }
  }
  return runs;
}

export function Ribbon({
  documentOpen,
  busy,
  editorActive,
  filterQuery,
  filterInputRef,
  onFilterQueryChange,
  onCloseProject,
  onOpenTmManage,
  onUndo,
  onRedo,
  onImport,
  onExport,
  onConfirmSegment,
  activeSegmentLocked,
  onToggleLock,
  onInsertTm,
  onInsertTerm,
  onPretranslate,
  onOpenFind,
  onOpenReplace,
  onFindNext,
  onConcordance,
  onRunQa,
  onTogglePreview,
}: RibbonProps) {
  const items: RibbonItem[] = [
    ...(onCloseProject
      ? [
          {
            id: "projects",
            group: "项目",
            label: "项目列表",
            title: "返回项目列表",
            icon: <IconFolders {...ICON_PROPS} />,
            onClick: onCloseProject,
          },
        ]
      : []),
    ...(onOpenTmManage
      ? [
          {
            id: "tm",
            group: "项目",
            label: "TM 管理",
            title: "TM 管理",
            icon: <IconDatabase {...ICON_PROPS} />,
            onClick: onOpenTmManage,
          },
        ]
      : []),
    {
      id: "undo",
      group: "历史",
      label: "撤销",
      title: "撤销（Ctrl+Z）",
      icon: <IconArrowBackUp {...ICON_PROPS} />,
      disabled: !editorActive,
      onClick: onUndo,
    },
    {
      id: "redo",
      group: "历史",
      label: "重做",
      title: "重做（Ctrl+Y）",
      icon: <IconArrowForwardUp {...ICON_PROPS} />,
      disabled: !editorActive,
      onClick: onRedo,
    },
    {
      id: "import",
      group: "文档",
      label: "导入",
      title: "导入文档（Ctrl+O）",
      icon: <IconFileImport {...ICON_PROPS} />,
      disabled: busy,
      onClick: onImport,
    },
    {
      id: "export",
      group: "文档",
      label: "导出译文",
      title: "导出译文（Ctrl+E）",
      icon: <IconFileExport {...ICON_PROPS} />,
      disabled: !documentOpen || busy,
      onClick: onExport,
    },
    {
      id: "confirm",
      group: "翻译",
      label: "确认句段",
      title: "确认句段（Ctrl+Enter）",
      icon: <IconCheck {...ICON_PROPS} />,
      disabled: !documentOpen,
      onClick: onConfirmSegment,
    },
    {
      id: "lock",
      group: "翻译",
      label: activeSegmentLocked ? "解锁句段" : "锁定句段",
      title: activeSegmentLocked ? "解锁句段（Ctrl+L）" : "锁定句段（Ctrl+L）",
      icon: activeSegmentLocked ? (
        <IconLockOpen {...ICON_PROPS} />
      ) : (
        <IconLock {...ICON_PROPS} />
      ),
      disabled: !documentOpen || activeSegmentLocked === null,
      onClick: onToggleLock,
    },
    {
      id: "insert-tm",
      group: "翻译",
      label: "插入记忆",
      title: "插入记忆匹配（Ctrl+1…9）",
      icon: <IconDatabaseImport {...ICON_PROPS} />,
      disabled: !documentOpen || activeSegmentLocked !== false,
      onClick: onInsertTm,
    },
    {
      id: "insert-term",
      group: "翻译",
      label: "插入术语",
      title: "插入术语",
      icon: <IconVocabulary {...ICON_PROPS} />,
      disabled: !documentOpen || activeSegmentLocked !== false,
      onClick: onInsertTerm,
    },
    {
      id: "pretranslate",
      group: "翻译",
      label: "预翻译",
      title: "预翻译",
      icon: <IconBolt {...ICON_PROPS} />,
      disabled: !documentOpen || busy,
      onClick: onPretranslate,
    },
    {
      id: "find",
      group: "审校",
      label: "查找",
      title: "查找（Ctrl+F）",
      icon: <IconSearch {...ICON_PROPS} />,
      disabled: !documentOpen,
      onClick: onOpenFind,
    },
    {
      id: "find-next",
      group: "审校",
      label: "查找下一个",
      title: "查找下一个（F4）",
      icon: <IconArrowDown {...ICON_PROPS} />,
      disabled: !documentOpen,
      onClick: onFindNext,
    },
    {
      id: "replace",
      group: "审校",
      label: "替换",
      title: "替换（Ctrl+H）",
      icon: <IconReplace {...ICON_PROPS} />,
      disabled: !documentOpen,
      onClick: onOpenReplace,
    },
    {
      id: "concordance",
      group: "审校",
      label: "检索",
      title: "检索（F3，取选中文本）",
      icon: <IconListSearch {...ICON_PROPS} />,
      onClick: onConcordance,
    },
    {
      id: "run-qa",
      group: "审校",
      label: "运行 QA",
      title: "对整篇文档运行质量检查",
      icon: <IconClipboardCheck {...ICON_PROPS} />,
      disabled: !documentOpen,
      onClick: onRunQa,
    },
    {
      id: "preview",
      group: "审校",
      label: "预览",
      title: "预览面板（Ctrl+P）",
      icon: <IconEye {...ICON_PROPS} />,
      disabled: !documentOpen,
      onClick: onTogglePreview,
    },
  ];

  const containerRef = useRef<HTMLDivElement | null>(null);
  const commandsRef = useRef<HTMLDivElement | null>(null);
  const tailRef = useRef<HTMLDivElement | null>(null);
  // Stable per-item widths measured while everything is visible; used to
  // decide how many leading items fit before the rest fold into 更多.
  const widthsRef = useRef(new Map<string, number>());
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const recompute = useCallback(() => {
    const container = containerRef.current;
    const tail = tailRef.current;
    if (!container || !tail || container.clientWidth === 0) {
      return;
    }
    const styles = getComputedStyle(container);
    const padding =
      (parseFloat(styles.paddingLeft) || 0) +
      (parseFloat(styles.paddingRight) || 0);
    // Reserve room for the search tail and the 更多 button + gaps.
    const available = container.clientWidth - padding - tail.offsetWidth - 56;
    let used = 0;
    let fit = 0;
    let previousGroup: string | null = null;
    for (const item of itemsRef.current) {
      const width = widthsRef.current.get(item.id) ?? 64;
      const divider =
        previousGroup !== null && previousGroup !== item.group ? 9 : 2;
      used += width + divider;
      if (used > available) {
        break;
      }
      fit += 1;
      previousGroup = item.group;
    }
    setVisibleCount((current) => (current === fit ? current : fit));
  }, []);

  // Measure item widths on mount (all items render once before folding).
  useLayoutEffect(() => {
    const commands = commandsRef.current;
    if (!commands) {
      return;
    }
    for (const element of commands.querySelectorAll<HTMLElement>(
      "[data-ribbon-id]",
    )) {
      const id = element.dataset["ribbonId"];
      if (id && element.offsetWidth > 0) {
        widthsRef.current.set(id, element.offsetWidth);
      }
    }
    recompute();
  }, [recompute]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => recompute());
    observer.observe(container);
    return () => observer.disconnect();
  }, [recompute]);

  // The 更多 menu closes on outside click or Escape, like a native menu.
  useEffect(() => {
    if (!moreOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);

  return (
    <div
      className="ribbon"
      role="toolbar"
      aria-label="工具栏"
      ref={containerRef}
    >
      <div className="ribbon__commands" ref={commandsRef}>
        {/* Consecutive items of one group render inside a labeled column, so
            the toolbar reads as 项目 / 文档 / 编辑 / 审校 rather than as a run
            of icons. Slots keep their data-ribbon-id and their own width, so
            the overflow measurement above is unaffected by the grouping. */}
        {groupRuns(visible).map((run, runIndex) => (
          <div key={`${run.group}-${runIndex}`} className="ribbon__group">
            {runIndex > 0 ? <span className="ribbon__divider" /> : null}
            <div className="ribbon__group-items">
              {run.items.map((item) => (
                <span
                  key={item.id}
                  className="ribbon__slot"
                  data-ribbon-id={item.id}
                >
                  <button
                    type="button"
                    className="ribbon__button"
                    title={item.title}
                    disabled={item.disabled}
                    onClick={item.onClick}
                  >
                    <span className="ribbon__icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="ribbon__label">{item.label}</span>
                  </button>
                </span>
              ))}
            </div>
            <span className="ribbon__group-label" aria-hidden="true">
              {run.group}
            </span>
          </div>
        ))}
        {overflow.length > 0 ? (
          <div className="ribbon__more" ref={moreRef}>
            <button
              type="button"
              className="ribbon__button"
              title="更多命令"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <span className="ribbon__icon" aria-hidden="true">
                <IconDots {...ICON_PROPS} />
              </span>
              <span className="ribbon__label">更多</span>
            </button>
            {moreOpen ? (
              <div className="ribbon__menu" role="menu">
                {overflow.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="ribbon__menu-item"
                    title={item.title}
                    disabled={item.disabled}
                    onClick={() => {
                      setMoreOpen(false);
                      item.onClick();
                    }}
                  >
                    <span className="ribbon__icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <span className="ribbon__spacer" />
      <div className="ribbon__search" ref={tailRef}>
        <span className="ribbon__search-box">
          <span className="ribbon__search-icon" aria-hidden="true">
            <IconSearch size={13} stroke={1.75} aria-hidden />
          </span>
          <input
            ref={filterInputRef}
            className="ribbon__search-input"
            aria-label="按文本筛选"
            placeholder="搜索句段"
            value={filterQuery}
            disabled={!documentOpen}
            onChange={(event) => onFilterQueryChange(event.target.value)}
          />
        </span>
      </div>
    </div>
  );
}
