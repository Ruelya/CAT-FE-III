import type { ReactNode } from "react";
import {
  ChatCircleText,
  Files,
  Newspaper,
} from "@phosphor-icons/react";

export type ActivityId = "files" | "preview" | "chat";

export interface ActivityBarProps {
  filesOpen: boolean;
  previewOpen: boolean;
  chatOpen: boolean;
  onToggle: (id: ActivityId) => void;
}

/**
 * VS Code-style activity rail. Each control is a 32px hit target and only
 * shows or hides a dock the translator already has — it does not invent a
 * second navigation system.
 */
export function ActivityBar({
  filesOpen,
  previewOpen,
  chatOpen,
  onToggle,
}: ActivityBarProps) {
  return (
    <nav className="activity-bar" aria-label="Workbench activity" data-testid="activity-bar">
      <ActivityButton
        id="files"
        label="Files"
        pressed={filesOpen}
        onToggle={onToggle}
        icon={<Files size={18} weight={filesOpen ? "fill" : "regular"} />}
      />
      <ActivityButton
        id="preview"
        label="Preview"
        pressed={previewOpen}
        onToggle={onToggle}
        icon={<Newspaper size={18} weight={previewOpen ? "fill" : "regular"} />}
      />
      <ActivityButton
        id="chat"
        label="AI chat"
        pressed={chatOpen}
        onToggle={onToggle}
        icon={<ChatCircleText size={18} weight={chatOpen ? "fill" : "regular"} />}
      />
    </nav>
  );
}

function ActivityButton({
  id,
  label,
  pressed,
  onToggle,
  icon,
}: {
  id: ActivityId;
  label: string;
  pressed: boolean;
  onToggle: (id: ActivityId) => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`activity-bar__btn${pressed ? " activity-bar__btn--active" : ""}`}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      data-testid={`activity-${id}`}
      onClick={() => onToggle(id)}
    >
      {icon}
    </button>
  );
}
