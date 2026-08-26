import type { ReactNode, Ref } from "react";

/**
 * Ribbon toolbar under the application menu: labeled icon groups that all
 * dispatch the exact same handlers as the menu commands and keyboard
 * chords — the ribbon never grows behavior of its own, and every button is
 * disabled honestly when its target state is missing (no document, busy).
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

interface RibbonButtonProps {
  label: string;
  title: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}

function RibbonButton({
  label,
  title,
  icon,
  disabled,
  onClick,
}: RibbonButtonProps) {
  return (
    <button
      type="button"
      className="ribbon__button"
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="ribbon__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="ribbon__label">{label}</span>
    </button>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ICONS = {
  projects: (
    <Icon>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Icon>
  ),
  tm: (
    <Icon>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </Icon>
  ),
  import: (
    <Icon>
      <path d="M12 3v10" />
      <path d="m8 9 4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  ),
  export: (
    <Icon>
      <path d="M12 13V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  ),
  confirm: (
    <Icon>
      <path d="m4 12.5 5 5L20 6.5" />
    </Icon>
  ),
  pretranslate: (
    <Icon>
      <path d="M13 2 4.5 13.5H11l-1 8.5L18.5 10H12z" />
    </Icon>
  ),
  find: (
    <Icon>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 5 5" />
    </Icon>
  ),
  replace: (
    <Icon>
      <path d="M4 8h12" />
      <path d="m13 4 4 4-4 4" />
      <path d="M20 16H8" />
      <path d="m11 12-4 4 4 4" />
    </Icon>
  ),
  filter: (
    <Icon>
      <path d="M4 5h16l-6.5 8v6l-3 2v-8z" />
    </Icon>
  ),
  concordance: (
    <Icon>
      <path d="M4 19.5V5a2 2 0 0 1 2-2h13v14H6a2 2 0 0 0-2 2.5z" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H19v-5" />
    </Icon>
  ),
  search: (
    <Icon>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 5 5" />
    </Icon>
  ),
};

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
  return (
    <div className="ribbon" role="toolbar" aria-label="工具栏">
      <div className="ribbon__group" role="group" aria-label="项目">
        {onCloseProject ? (
          <RibbonButton
            label="项目列表"
            title="返回项目列表"
            icon={ICONS.projects}
            onClick={onCloseProject}
          />
        ) : null}
        {onOpenTmManage ? (
          <RibbonButton
            label="TM 管理"
            title="管理项目翻译记忆（查看 / 导入 / 导出 / 删除条目）"
            icon={ICONS.tm}
            onClick={onOpenTmManage}
          />
        ) : null}
      </div>
      <span className="ribbon__divider" />
      <div className="ribbon__group" role="group" aria-label="文档">
        <RibbonButton
          label="导入"
          title="导入文档（Ctrl+O）"
          icon={ICONS.import}
          disabled={busy}
          onClick={onImport}
        />
        <RibbonButton
          label="导出译文"
          title="导出当前文档的译文（Ctrl+E）"
          icon={ICONS.export}
          disabled={!documentOpen || busy}
          onClick={onExport}
        />
      </div>
      <span className="ribbon__divider" />
      <div className="ribbon__group" role="group" aria-label="编辑">
        <RibbonButton
          label="确认句段"
          title="确认当前正在编辑的句段（Ctrl+Enter）"
          icon={ICONS.confirm}
          disabled={!documentOpen}
          onClick={onConfirmSegment}
        />
        <RibbonButton
          label="预翻译"
          title="用项目 TM 填充未译句段"
          icon={ICONS.pretranslate}
          disabled={!documentOpen || busy}
          onClick={onPretranslate}
        />
      </div>
      <span className="ribbon__divider" />
      <div className="ribbon__group" role="group" aria-label="审校">
        <RibbonButton
          label="查找"
          title="查找并跳转句段（F4 下一个）"
          icon={ICONS.find}
          disabled={!documentOpen}
          onClick={onFocusFind}
        />
        <RibbonButton
          label="替换…"
          title="替换译文文本（Ctrl+H）"
          icon={ICONS.replace}
          disabled={!documentOpen}
          onClick={onFocusReplace}
        />
        <RibbonButton
          label="筛选"
          title="按状态或文本筛选句段（Ctrl+F）"
          icon={ICONS.filter}
          disabled={!documentOpen}
          onClick={onFocusFilter}
        />
        <RibbonButton
          label="一致性检索"
          title="在 TM 与当前文档中检索（F3，取选中文本）"
          icon={ICONS.concordance}
          onClick={onConcordance}
        />
      </div>
      <span className="ribbon__spacer" />
      <div className="ribbon__search">
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
            {ICONS.search}
          </span>
          <input
            ref={filterInputRef}
            className="ribbon__search-input"
            aria-label="按文本筛选"
            placeholder="搜索句段（Ctrl+F）"
            value={filterQuery}
            disabled={!documentOpen}
            onChange={(event) => onFilterQueryChange(event.target.value)}
          />
        </span>
      </div>
    </div>
  );
}
