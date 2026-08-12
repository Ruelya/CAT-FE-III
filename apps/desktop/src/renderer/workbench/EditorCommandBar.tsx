import { useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CaretDown,
  ChatText,
  CheckSquareOffset,
  GearSix,
  MagnifyingGlass,
  Scissors,
  TextAa,
  Tag,
  TextT,
  Translate,
  TreeStructure,
} from "@phosphor-icons/react";

import {
  EDITOR_COMMAND_REGISTRY,
  type EditorCommandId,
} from "../state/editor-operations";
import type { EditorOperationsApi } from "../state/use-editor-operations";
import { useMenuKeyboard, useToolbarRoving } from "../shell/use-menu-keyboard";

export interface EditorCommandBarProps {
  ops: EditorOperationsApi;
  disabled?: boolean;
}

const ICONS: Record<EditorCommandId, ReactNode> = {
  "editor.findReplace": <MagnifyingGlass size={16} weight="regular" />,
  "editor.tags": <Tag size={16} weight="regular" />,
  "editor.comments": <ChatText size={16} weight="regular" />,
  "editor.undo": <ArrowCounterClockwise size={16} weight="regular" />,
  "editor.redo": <ArrowClockwise size={16} weight="regular" />,
  "editor.propagate": <TreeStructure size={16} weight="regular" />,
  "editor.split": <Scissors size={16} weight="regular" />,
  "editor.merge": <TextT size={16} weight="regular" />,
  "editor.correctSource": <TextT size={16} weight="bold" />,
  "editor.spell": <TextAa size={16} weight="regular" />,
  "editor.chinese": <Translate size={16} weight="regular" />,
  "editor.history": <ArrowCounterClockwise size={16} weight="bold" />,
  "editor.preferences": <GearSix size={16} weight="regular" />,
  "editor.review": <CheckSquareOffset size={16} weight="regular" />,
};

const PRIMARY = EDITOR_COMMAND_REGISTRY.filter(
  (c) => c.placement === "primary",
);
const OVERFLOW = EDITOR_COMMAND_REGISTRY.filter(
  (c) => c.placement === "overflow",
);

export function EditorCommandBar({ ops, disabled }: EditorCommandBarProps) {
  const busy = disabled || ops.busy;
  const [overflowOpen, setOverflowOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const menu = useMenuKeyboard({
    open: overflowOpen,
    setOpen: setOverflowOpen,
    triggerRef,
    menuRef,
  });
  const onToolbarKeyDown = useToolbarRoving(primaryRef);

  // A toolbar is one Tab stop: the first enabled command is reachable and the
  // rest are visited with Arrow keys.
  const firstEnabled = PRIMARY.find(
    (cmd) => !busy && ops.isAvailable(cmd.id),
  )?.id;

  return (
    <div
      className="editor-command-bar"
      data-testid="editor-command-bar"
      role="toolbar"
      aria-label="Editor"
      ref={rootRef}
    >
      <div
        className="editor-command-bar__primary"
        ref={primaryRef}
        onKeyDown={onToolbarKeyDown}
      >
        {PRIMARY.map((cmd) => {
          const title = cmd.shortcut
            ? `${cmd.label} (${cmd.shortcut})`
            : cmd.label;
          return (
            <button
              key={cmd.id}
              type="button"
              className="btn btn--ghost btn--sm"
              title={title}
              aria-label={title}
              tabIndex={cmd.id === firstEnabled ? 0 : -1}
              disabled={busy || !ops.isAvailable(cmd.id)}
              onClick={() => ops.runCommand(cmd.id)}
              data-testid={`cmd-${cmd.id}`}
            >
              {ICONS[cmd.id]}
              <span className="editor-command-bar__label">{cmd.label}</span>
            </button>
          );
        })}
      </div>
      <div className="editor-command-bar__overflow">
        <button
          ref={triggerRef}
          type="button"
          className="btn btn--ghost btn--sm"
          aria-haspopup="menu"
          aria-expanded={overflowOpen}
          aria-controls={overflowOpen ? menuId : undefined}
          disabled={busy}
          onClick={menu.toggle}
          onKeyDown={menu.onTriggerKeyDown}
          data-testid="cmd-overflow"
          title="More"
        >
          More
          <CaretDown size={14} weight="bold" />
        </button>
        {overflowOpen ? (
          <div
            ref={menuRef}
            className="editor-command-bar__menu"
            role="menu"
            aria-label="More editor commands"
            id={menuId}
            onKeyDown={menu.onMenuKeyDown}
            data-testid="cmd-overflow-menu"
          >
            {OVERFLOW.map((cmd) => {
              const title = cmd.shortcut
                ? `${cmd.label} (${cmd.shortcut})`
                : cmd.label;
              const enabled = !busy && ops.isAvailable(cmd.id);
              return (
                <button
                  key={cmd.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="editor-command-bar__menu-item"
                  title={title}
                  aria-label={title}
                  aria-disabled={enabled ? undefined : true}
                  disabled={!enabled}
                  onClick={() => {
                    menu.close(true);
                    ops.runCommand(cmd.id);
                  }}
                  data-testid={`cmd-${cmd.id}`}
                >
                  {ICONS[cmd.id]}
                  <span>{cmd.label}</span>
                  {cmd.shortcut ? (
                    <span className="editor-command-bar__shortcut">
                      {cmd.shortcut}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {ops.commandError ? (
        <p
          className="error-text"
          role="status"
          data-testid="editor-command-error"
        >
          {ops.commandError.message}
        </p>
      ) : null}
      {ops.busy ? (
        <span className="inline-status" role="status">
          Working
        </span>
      ) : null}
    </div>
  );
}
