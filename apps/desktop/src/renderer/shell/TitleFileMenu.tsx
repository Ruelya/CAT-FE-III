import { useId, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";

import { useMenuKeyboard } from "./use-menu-keyboard";

export interface TitleFileMenuItem {
  id: string;
  label: string;
  group: "job" | "project";
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
}

export interface TitleFileMenuProps {
  items: readonly TitleFileMenuItem[];
  disabled?: boolean;
}

const GROUP_LABEL: Record<TitleFileMenuItem["group"], string> = {
  job: "This job",
  project: "Project",
};

const GROUP_ORDER: Array<TitleFileMenuItem["group"]> = ["job", "project"];

/**
 * Word / Trados File menu, hung from the title strip.
 *
 * This is a grouped menu, not a full-screen backstage and not a second
 * ribbon. Lifecycle actions live here so the workbench strip can stay
 * identity, progress, view, and the current job.
 */
export function TitleFileMenu({ items, disabled }: TitleFileMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menu = useMenuKeyboard({ open, setOpen, triggerRef, menuRef });

  if (items.length === 0) return null;

  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);

  return (
    <div className="title-file-menu" data-no-drag>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--ghost btn--sm title-file-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled === true}
        onClick={menu.toggle}
        onKeyDown={menu.onTriggerKeyDown}
        data-testid="title-file-menu"
        title="File"
      >
        File
        <CaretDown size={12} weight="bold" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className="menu title-file-menu__panel"
          role="menu"
          aria-label="File"
          onKeyDown={menu.onMenuKeyDown}
          data-testid="title-file-menu-panel"
        >
          {groups.map((entry, index) => (
            <div key={entry.group} className="title-file-menu__group">
              {index > 0 ? <div className="menu__separator" /> : null}
              <p className="title-file-menu__heading">{GROUP_LABEL[entry.group]}</p>
              {entry.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={
                    item.danger ? "menu__item menu__item--danger" : "menu__item"
                  }
                  aria-disabled={item.disabled ? true : undefined}
                  disabled={item.disabled}
                  onClick={() => {
                    menu.close(true);
                    item.onSelect();
                  }}
                  {...(item.testId ? { "data-testid": item.testId } : {})}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
