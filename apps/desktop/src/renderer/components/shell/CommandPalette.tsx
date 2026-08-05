import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Command Palette 命令面板（Ctrl+K）
 *
 * F2/F3 频率档的统一出口。上一代散落在工具条与 `…` 菜单里的功能收敛到这里。
 *
 * 关键约束（06-shell-navigation.md §3）：
 * - 不居中：贴视口左上 1/3，活动行仍可见
 * - 前缀过滤：`>` 动作 · `#` 段落 · `@` 文档 · `?` 帮助
 * - 命中字符用 signal 加粗，不用背景高亮
 * - 破坏性动作不直接执行，回车后转确认对话框（由调用方在 run 内实现）
 * - Esc 关闭并把焦点还给触发处
 * - IME 组合态期间不响应（由调用方的 Ctrl+K 分发守卫保证）
 *
 * Source: docs/design-ii/06-shell-navigation.md §3
 */

export type CommandGroup = "动作" | "跳转" | "文档" | "段落" | "插件" | "最近";

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  /** 右侧提示：快捷键或补充说明 */
  meta?: string;
  /** 破坏性动作：以 --err 呈现；run 内应转为确认对话框 */
  danger?: boolean;
  run: () => void;
}

/** 前缀 → 分组过滤 */
const PREFIX_GROUP: Record<string, CommandGroup> = {
  ">": "动作",
  "#": "段落",
  "@": "文档",
};

interface CommandPaletteProps {
  open: boolean;
  commands: readonly Command[];
  onClose: () => void;
  /** 空态次级动作：搜索全部段落 */
  onSearchAll?: ((query: string) => void) | undefined;
}

export function CommandPalette({
  open,
  commands,
  onClose,
  onSearchAll,
}: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  // 打开/关闭 <dialog>，并在关闭时把焦点还给触发处
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;

    if (open && !node.open) {
      node.showModal();
      setQuery("");
      setActiveIndex(0);
      inputRef.current?.focus();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  const { groupFilter, term } = useMemo(() => parseQuery(query), [query]);

  const results = useMemo(() => {
    const pool = groupFilter
      ? commands.filter((c) => c.group === groupFilter)
      : commands;

    if (!term) return pool.slice(0, 50);

    return pool
      .map((command) => ({
        command,
        score: subsequenceScore(command.label, term),
      }))
      .filter((entry) => entry.score !== null)
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
      .slice(0, 50)
      .map((entry) => entry.command);
  }, [commands, groupFilter, term]);

  // 结果集变化后夹紧游标，避免指向不存在的项
  useEffect(() => {
    setActiveIndex((current) =>
      results.length === 0 ? 0 : Math.min(current, results.length - 1),
    );
  }, [results.length]);

  const grouped = useMemo(() => groupResults(results), [results]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) =>
        results.length === 0 ? 0 : (i - 1 + results.length) % results.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = results[activeIndex];
      if (target) {
        onClose();
        target.run();
      }
      return;
    }
    if (event.key === "Escape") {
      // <dialog> 自带 Esc 关闭，这里只保证状态同步
      event.preventDefault();
      onClose();
    }
  };

  let flatIndex = -1;

  return (
    <dialog
      ref={dialogRef}
      className="cmdk"
      aria-label="命令面板"
      onKeyDown={handleKeyDown}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="cmdk__input">
        <input
          ref={inputRef}
          className="cmdk__field"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          placeholder="输入命令、段号或文档名"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={
            results[activeIndex] ? `cmdk-${results[activeIndex].id}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>Esc</kbd>
      </div>

      <ul id="cmdk-list" role="listbox" className="cmdk__list">
        {grouped.map(([group, items]) => (
          <li key={group}>
            <div className="cmdk__group micro" role="presentation">
              {group}
            </div>
            <ul role="group" aria-label={group}>
              {items.map((command) => {
                flatIndex += 1;
                const isActive = flatIndex === activeIndex;
                return (
                  <li key={command.id}>
                    <button
                      type="button"
                      id={`cmdk-${command.id}`}
                      className="cmdk__item"
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive || undefined}
                      data-danger={command.danger || undefined}
                      onClick={() => {
                        onClose();
                        command.run();
                      }}
                    >
                      <span className="cmdk__label">
                        {highlight(command.label, term)}
                      </span>
                      {command.meta ? (
                        <span className="cmdk__meta num">{command.meta}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}

        {results.length === 0 ? (
          <li className="cmdk__empty">
            <div>没有匹配 “{term || query}”</div>
            {onSearchAll && term ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  onClose();
                  onSearchAll(term);
                }}
              >
                搜索全部段落
              </button>
            ) : null}
          </li>
        ) : null}
      </ul>

      <footer className="cmdk__hint micro">
        <span>↑↓ 选择</span>
        <span>↵ 执行</span>
        <span>&gt; 动作</span>
        <span># 段落</span>
        <span>@ 文档</span>
      </footer>
    </dialog>
  );
}

function parseQuery(raw: string): {
  groupFilter: CommandGroup | null;
  term: string;
} {
  const first = raw.slice(0, 1);
  const group = PREFIX_GROUP[first];
  if (group) {
    return { groupFilter: group, term: raw.slice(1).trim() };
  }
  return { groupFilter: null, term: raw.trim() };
}

function groupResults(
  results: readonly Command[],
): [CommandGroup, Command[]][] {
  const map = new Map<CommandGroup, Command[]>();
  for (const command of results) {
    const bucket = map.get(command.group);
    if (bucket) bucket.push(command);
    else map.set(command.group, [command]);
  }
  return [...map.entries()];
}

/**
 * 子序列模糊匹配。返回跨度（越小越紧凑）作为排序分数，不匹配返回 null。
 */
function subsequenceScore(label: string, term: string): number | null {
  if (!term) return 0;
  const haystack = label.toLowerCase();
  const needle = term.toLowerCase();

  let cursor = 0;
  let first = -1;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return null;
    if (first === -1) first = found;
    cursor = found + 1;
  }
  return cursor - first;
}

/** 命中字符加粗（不用背景高亮） */
function highlight(label: string, term: string) {
  if (!term) return label;

  const lower = label.toLowerCase();
  const needle = term.toLowerCase();
  const parts: React.ReactNode[] = [];

  let cursor = 0;
  let plainStart = 0;

  for (const char of needle) {
    const found = lower.indexOf(char, cursor);
    if (found === -1) break;
    if (found > plainStart) {
      parts.push(label.slice(plainStart, found));
    }
    parts.push(
      <b key={`${found}-${char}`} className="cmdk__hit">
        {label[found]}
      </b>,
    );
    cursor = found + 1;
    plainStart = cursor;
  }

  if (plainStart < label.length) parts.push(label.slice(plainStart));
  return parts;
}
