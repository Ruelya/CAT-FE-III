import { PaperPlaneTilt } from "@phosphor-icons/react";

import { textPrompt } from "../lib/acp-session";
import type { useAcpChat } from "../state/use-acp-chat";

export interface AcpChatPanelProps {
  chat: ReturnType<typeof useAcpChat>;
  disabled?: boolean;
}

/**
 * In-workbench ACP chat. The wire is Engine `ai.run` / conversation; the
 * session/prompt/chunk vocabulary is ACP so a later stdio agent can replace
 * the adapter without changing this panel.
 */
export function AcpChatPanel({ chat, disabled }: AcpChatPanelProps) {
  const busy = Boolean(disabled || chat.pending);
  return (
    <section className="acp-chat" data-testid="acp-chat" aria-label="AI chat">
      <header className="acp-chat__head">
        <h2 className="acp-chat__title">Chat</h2>
        <p className="acp-chat__meta">ACP session over the current segment</p>
      </header>
      <ol className="acp-chat__log">
        {chat.messages.length === 0 ? (
          <li className="muted">Ask about this segment, a term, or a match.</li>
        ) : (
          chat.messages.map((message) => (
            <li
              key={message.id}
              className={`acp-chat__msg acp-chat__msg--${message.role}`}
              data-testid={`acp-msg-${message.role}`}
            >
              <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
              <p>{message.text}</p>
            </li>
          ))
        )}
      </ol>
      {chat.error ? (
        <p className="error-text" role="alert">
          {chat.error}
        </p>
      ) : null}
      {!chat.runnable ? (
        <p className="muted">Store an AI key in AI Control to chat.</p>
      ) : null}
      <form
        className="acp-chat__composer"
        onSubmit={(event) => {
          event.preventDefault();
          void chat.prompt(textPrompt(chat.draft));
        }}
      >
        <label className="field acp-chat__field">
          <span className="sr-only">Message</span>
          <textarea
            className="field__control"
            rows={2}
            value={chat.draft}
            disabled={busy || !chat.runnable}
            onChange={(event) => chat.setDraft(event.target.value)}
            data-testid="acp-chat-input"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void chat.prompt(textPrompt(chat.draft));
              }
            }}
          />
        </label>
        <button
          type="submit"
          className="btn btn--primary btn--icon"
          disabled={busy || !chat.runnable || !chat.draft.trim()}
          aria-label="Send"
          title="Send"
          data-testid="acp-chat-send"
        >
          <PaperPlaneTilt size={16} weight="bold" />
        </button>
      </form>
    </section>
  );
}
