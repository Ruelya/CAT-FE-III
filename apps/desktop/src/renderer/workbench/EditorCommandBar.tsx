import { useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  BracketsAngle,
  ChatText,
  Check,
  CheckSquareOffset,
  Copy,
  DotsThree,
  FloppyDisk,
  GearSix,
  Lightning,
  MagnifyingGlass,
  Scissors,
  Tag,
  TextAa,
  TextT,
  Translate,
  TreeStructure,
} from "@phosphor-icons/react";

import type { EditorWorkflowState } from "@translunar/contracts";

import { segmentNumber } from "../lib/format";
import {
  EDITOR_COMMAND_REGISTRY,
  type EditorCommandId,
} from "../state/editor-operations";
import type { EditorOperationsApi } from "../state/use-editor-operations";
import { useMenuKeyboard, useToolbarRoving } from "../shell/use-menu-keyboard";

export interface EditorCommandBarExtras {
  onCopySource?: () => void;
  onPlaceTags?: () => void;
  onSave?: () => void;
  onPretranslate?: () => void;
  pretranslatePending?: boolean;
  canCopySource?: boolean;
  canPlaceTags?: boolean;
  canSave?: boolean;
}

export interface EditorCommandBarProps {
  ops: EditorOperationsApi;
  disabled?: boolean;
  confirm?: {
    segmentId: string;
    ordinal: number;
    disabled?: boolean;
    onConfirm: () => void;
  };
  extras?: EditorCommandBarExtras;
  workflow?: {
    state: EditorWorkflowState;
    disabled?: boolean;
    onChange: (state: EditorWorkflowState) => void;
  };
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

type RibbonId =
  | EditorCommandId
  | "ribbon.copySource"
  | "ribbon.placeTags"
  | "ribbon.save"
  | "ribbon.pretranslate";

export function EditorCommandBar({
  ops,
  disabled,
  confirm,
  extras,
  workflow,
}: EditorCommandBarProps) {
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

  const extraItems: { id: RibbonId; available: boolean }[] = [];
  if (extras?.onCopySource) {
    extraItems.push({
      id: "ribbon.copySource",
      available: !busy && extras.canCopySource !== false,
    });
  }
  if (extras?.onPlaceTags) {
    extraItems.push({
      id: "ribbon.placeTags",
      available: !busy && extras.canPlaceTags !== false,
    });
  }
  if (extras?.onSave) {
    extraItems.push({
      id: "ribbon.save",
      available: !busy && extras.canSave !== false,
    });
  }
  if (extras?.onPretranslate) {
    extraItems.push({
      id: "ribbon.pretranslate",
      available: !busy && extras.pretranslatePending !== true,
    });
  }

  // A toolbar is one Tab stop: the first enabled command is reachable and the
  // rest are visited with Arrow keys.
  const firstEnabled =
    PRIMARY.find((cmd) => !busy && ops.isAvailable(cmd.id))?.id ??
    extraItems.find((item) => item.available)?.id;

  return (
    <div
      className="editor-command-bar"
      data-testid="editor-command-bar"
      role="toolbar"
      aria-label="Editor"
      ref={rootRef}
    >
      {confirm ? (
        <button
          type="button"
          className="btn btn--primary btn--sm"
          title="Confirm (Ctrl+Enter)"
          aria-label={`Confirm segment ${segmentNumber(confirm.ordinal)}`}
          disabled={busy || confirm.disabled === true}
          onClick={confirm.onConfirm}
          data-testid={`confirm-segment-${confirm.segmentId}`}
        >
          <Check size={16} weight="bold" />
          <span className="editor-command-bar__label">Confirm</span>
        </button>
      ) : null}
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
        {extras?.onCopySource ? (
          <RibbonButton
            id="ribbon.copySource"
            firstEnabled={firstEnabled}
            title="Copy source to target (Ctrl+Insert)"
            disabled={busy || extras.canCopySource === false}
            onClick={extras.onCopySource}
            icon={<Copy size={16} weight="regular" />}
            label="Copy source"
          />
        ) : null}
        {extras?.onPlaceTags ? (
          <RibbonButton
            id="ribbon.placeTags"
            firstEnabled={firstEnabled}
            title="Place source tags (Ctrl+,)"
            disabled={busy || extras.canPlaceTags === false}
            onClick={extras.onPlaceTags}
            icon={<BracketsAngle size={16} weight="regular" />}
            label="Place tags"
          />
        ) : null}
        {extras?.onSave ? (
          <RibbonButton
            id="ribbon.save"
            firstEnabled={firstEnabled}
            title="Save (Ctrl+S)"
            disabled={busy || extras.canSave === false}
            onClick={extras.onSave}
            icon={<FloppyDisk size={16} weight="regular" />}
            label="Save"
          />
        ) : null}
        {extras?.onPretranslate ? (
          <RibbonButton
            id="ribbon.pretranslate"
            firstEnabled={firstEnabled}
            title="Pretranslate from memory (Ctrl+Shift+P)"
            disabled={busy || extras.pretranslatePending === true}
            onClick={extras.onPretranslate}
            icon={<Lightning size={16} weight="regular" />}
            label={extras.pretranslatePending ? "Pretranslating" : "Pretranslate"}
          />
        ) : null}
      </div>
      {workflow ? (
        <label className="editor-command-bar__workflow">
          <span className="editor-command-bar__workflow-label">Workflow</span>
          <select
            className="editor-command-bar__workflow-select"
            data-testid="cmd-workflow"
            title="Segment workflow. Ctrl+Alt+T translation, Ctrl+Alt+R review, Ctrl+L sign off"
            aria-label="Segment workflow"
            value={workflow.state}
            disabled={busy || workflow.disabled === true}
            onChange={(event) =>
              workflow.onChange(event.target.value as EditorWorkflowState)
            }
          >
            <option value="translation">Translation</option>
            <option value="review">Review</option>
            <option value="signed">Signed off</option>
          </select>
        </label>
      ) : null}
      <div className="editor-command-bar__overflow">
        <button
          ref={triggerRef}
          type="button"
          className="btn btn--ghost btn--sm"
          aria-haspopup="menu"
          aria-expanded={overflowOpen}
          aria-controls={overflowOpen ? menuId : undefined}
          aria-label="More"
          disabled={busy}
          onClick={menu.toggle}
          onKeyDown={menu.onTriggerKeyDown}
          data-testid="cmd-overflow"
          title="More"
        >
          <DotsThree size={16} weight="bold" />
          <span className="editor-command-bar__label">More</span>
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

function RibbonButton({
  id,
  firstEnabled,
  title,
  disabled,
  onClick,
  icon,
  label,
}: {
  id: RibbonId;
  firstEnabled: RibbonId | undefined;
  title: string;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      title={title}
      aria-label={title}
      tabIndex={id === firstEnabled ? 0 : -1}
      disabled={disabled}
      onClick={onClick}
      data-testid={`cmd-${id}`}
    >
      {icon}
      <span className="editor-command-bar__label">{label}</span>
    </button>
  );
}
