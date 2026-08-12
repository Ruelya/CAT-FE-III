import { useId, useRef, useState } from "react";
import { DotsThree } from "@phosphor-icons/react";

import { useMenuKeyboard } from "./use-menu-keyboard";

export interface RowMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
}

export interface RowMenuProps {
  /**
   * Accessible name for the trigger. Must identify the row, for example
   * "More actions for Aurora Field Guide", so repeated rows are
   * distinguishable to a screen reader.
   */
  label: string;
  items: RowMenuItem[];
  disabled?: boolean;
  testId?: string;
}

/**
 * Overflow menu for secondary and destructive row actions.
 * Keyboard model lives in `useMenuKeyboard` and follows the APG menu button
 * pattern; see that file for the contract.
 */
export function RowMenu({ label, items, disabled, testId }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menu = useMenuKeyboard({ open, setOpen, triggerRef, menuRef });

  const enabled = items.filter((item) => !item.disabled);

  return (
    <div className="row-menu">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled || enabled.length === 0}
        onClick={menu.toggle}
        onKeyDown={menu.onTriggerKeyDown}
        {...(testId ? { "data-testid": testId } : {})}
      >
        <DotsThree size={16} weight="bold" />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className="menu row-menu__menu"
          role="menu"
          aria-label={label}
          onKeyDown={menu.onMenuKeyDown}
        >
          {items.map((item) => (
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
      ) : null}
    </div>
  );
}
