import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode, Ref } from "react";

import {
  IconBolt,
  IconCheck,
  IconDatabase,
  IconDots,
  IconFileExport,
  IconFileImport,
  IconFilter,
  IconFolders,
  IconListSearch,
  IconReplace,
  IconSearch,
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
  /** Live segment filter (the far-right search box, Ctrl+F). */
  filterQuery: string;
  filterActive: boolean;
  filteredCount: number;
  totalCount: number;
  filterInputRef: Ref<HTMLInputElement>;
  onFilterQueryChange: (value: string) => void;
  onClearFilter: () => void;
  onCloseProject?: (() => void) | undefined;
  onOpenTmManage?: (() => void) | undefined;
  onImport: () => void;
  onExport: () => void;
  onConfirmSegment: () => void;
  onPretranslate: () => void;
  onFocusFind: () => void;
  onFocusReplace: () => void;
  onFocusFilter: () => void;
  onConcordance: () => void;
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

export function Ribbon({
  documentOpen,
  busy,
  filterQuery,
  filterActive,
  filteredCount,
  totalCount,
  filterInputRef,
  onFilterQueryChange,
  onClearFilter,
  onCloseProject,
  onOpenTmManage,
  onImport,
  onExport,
  onConfirmSegment,
  onPretranslate,
  onFocusFind,
  onFocusReplace,
  onFocusFilter,
  onConcordance,
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
      group: "编辑",
      label: "确认句段",
      title: "确认句段（Ctrl+Enter）",
      icon: <IconCheck {...ICON_PROPS} />,
      disabled: !documentOpen,
      onClick: onConfirmSegment,
    },
    {
      id: "pretranslate",
      group: "编辑",
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
      title: "查找（F4）",
      icon: <IconSearch {...ICON_PROPS} />,
      disabled: !documentOpen,
      onClick: onFocusFind,
    },
    {
      id: "replace",
      group: "审校",
      label: "替换",
      title: "替换（Ctrl+H）",
      icon: <IconReplace {...ICON_PROPS} />,
      disabled: !documentOpen,
      onClick: onFocusReplace,
    },
    {
      id: "filter",
      group: "审校",
      label: "筛选",
      title: "筛选（Ctrl+F）",
      icon: <IconFilter {...ICON_PROPS} />,
      disabled: !documentOpen,
      onClick: onFocusFilter,
    },
    {
      id: "concordance",
      group: "审校",
      label: "检索",
      title: "检索（F3，取选中文本）",
      icon: <IconListSearch {...ICON_PROPS} />,
      onClick: onConcordance,
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
        {visible.map((item, index) => (
          <span key={item.id} className="ribbon__slot" data-ribbon-id={item.id}>
            {index > 0 && visible[index - 1]!.group !== item.group ? (
              <span className="ribbon__divider" />
            ) : null}
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
        {filterActive ? (
          <>
            <span className="ribbon__filter-count tl-num">
              {filteredCount}/{totalCount}
            </span>
            <button
              type="button"
              className="ribbon__filter-clear"
              onClick={onClearFilter}
            >
              清除
            </button>
          </>
        ) : null}
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
