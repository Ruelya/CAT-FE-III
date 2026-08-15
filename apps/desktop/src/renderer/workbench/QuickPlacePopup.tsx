import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Placeable, PlaceableKind } from "../lib/quickplace";

export interface QuickPlacePopupProps {
  items: Placeable[];
  activeIndex: number;
  onHover: (index: number) => void;
  onAccept: (item: Placeable) => void;
  onDismiss: () => void;
}

const KIND_LABEL: Record<PlaceableKind, string> = {
  "all-tags": "tags",
  "tag-pair": "pair",
  tag: "tag",
  number: "number",
  date: "date",
  email: "email",
  url: "url",
};

export function QuickPlacePopup({
  items,
  activeIndex,
  onHover,
  onAccept,
  onDismiss,
}: QuickPlacePopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);

  useEffect(() => {
    const onWindowBlur = () => onDismiss();
    window.addEventListener("blur", onWindowBlur);
    return () => window.removeEventListener("blur", onWindowBlur);
  }, [onDismiss]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setAbove(false);
    const frame = requestAnimationFrame(() => {
      const box = element.getBoundingClientRect();
      const room = window.innerHeight - box.top;
      setAbove(box.height > room && box.top > box.height);
    });
    return () => cancelAnimationFrame(frame);
  }, [items]);

  if (items.length === 0) {
    return (
      <div
        className="suggestions"
        data-testid="quickplace-popup"
        role="status"
      >
        <p className="suggestions__legend">Nothing to place from the source</p>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`suggestions${above ? " suggestions--above" : ""}`}
      data-testid="quickplace-popup"
      role="listbox"
      aria-label="QuickPlace"
    >
      <ul className="suggestions__list">
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              className={`suggestions__item${
                index === activeIndex ? " suggestions__item--active" : ""
              }`}
              data-testid={`quickplace-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHover(index)}
              onClick={() => onAccept(item)}
            >
              <span className="suggestions__text">{item.label}</span>
              <span className="suggestions__source">{KIND_LABEL[item.kind]}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="suggestions__legend">
        Enter to place, Esc to close. A selection wraps a tag pair.
      </p>
    </div>
  );
}
