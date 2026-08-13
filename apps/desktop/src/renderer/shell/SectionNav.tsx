export interface SectionNavItem<Id extends string> {
  id: Id;
  label: string;
  testId?: string;
  disabled?: boolean;
}

export interface SectionNavProps<Id extends string> {
  /** Accessible name for the navigation region, for example "Asset sections". */
  label: string;
  items: ReadonlyArray<SectionNavItem<Id>>;
  current: Id;
  onSelect: (id: Id) => void;
  disabled?: boolean;
  testId?: string;
}

/**
 * Section switching that behaves like a route.
 *
 * Seven surfaces used to declare role="tab" with aria-selected while
 * implementing none of the tab keyboard model: no roving tabIndex, no arrow
 * keys, no aria-controls, no named tabpanel. A native nav with aria-current is
 * the honest semantic for switching between route-like sections, it is fully
 * keyboard operable with Tab and Enter, and it does not promise behaviour the
 * widget does not have.
 *
 * Use a real tab widget only when the sections are genuinely panels of one
 * control, and then implement the whole APG pattern.
 */
export function SectionNav<Id extends string>({
  label,
  items,
  current,
  onSelect,
  disabled,
  testId,
}: SectionNavProps<Id>) {
  return (
    <nav
      className="section-nav"
      aria-label={label}
      {...(testId ? { "data-testid": testId } : {})}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="section-nav__item"
          aria-current={item.id === current ? "page" : undefined}
          disabled={disabled || item.disabled}
          onClick={() => onSelect(item.id)}
          {...(item.testId ? { "data-testid": item.testId } : {})}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
