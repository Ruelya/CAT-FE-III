import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TermMatch, TermTranslation, TmMatch } from "@translunar/contracts";

import { EMPTY_SEGMENT_INTEL } from "../state/segment-intel";
import { IntelDock } from "./IntelDock";

afterEach(cleanup);

function translation(
  term: string,
  flags: Partial<Pick<TermTranslation, "preferred" | "forbidden">> = {},
): TermTranslation {
  return {
    id: `tr-${term}`,
    entryId: "e1",
    locale: "zh",
    term,
    preferred: flags.preferred === true,
    forbidden: flags.forbidden === true,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function termMatch(
  sourceTerm: string,
  translations: TermTranslation[],
  start = 0,
  end = sourceTerm.length,
): TermMatch {
  return {
    start,
    end,
    entryId: sourceTerm,
    sourceTerm,
    termbaseId: "tb",
    translations,
  };
}

const ai = {
  action: "translate" as const,
  run: null,
  pending: false,
  error: null,
  profiles: [],
  profilesLoaded: true,
  setAction: vi.fn(),
  generate: vi.fn(),
};

function renderTerms(
  terms: TermMatch[],
  extras: Partial<{
    onInsert: (translation: string) => void;
    onSearchTerms: (query: string) => Promise<TermMatch[]>;
    onHighlightTerm: (span: { start: number; end: number } | null) => void;
  }> = {},
) {
  const onInsert = extras.onInsert ?? vi.fn();
  render(
    <IntelDock
      intel={{
        ...EMPTY_SEGMENT_INTEL,
        segmentId: "seg-1",
        terms: { matches: terms, loading: false, error: null },
      }}
      collapsed={false}
      onToggle={() => undefined}
      onApplyMatch={() => undefined}
      onInsertTerm={onInsert}
      onConcordance={() => undefined}
      onQuickAddTerm={() => undefined}
      canQuickAddTerm={false}
      {...(extras.onSearchTerms ? { onSearchTerms: extras.onSearchTerms } : {})}
      {...(extras.onHighlightTerm
        ? { onHighlightTerm: extras.onHighlightTerm }
        : {})}
      ai={ai}
      onApplyAiProposal={() => undefined}
    />,
  );
  return { onInsert };
}

function tmMatch(): TmMatch {
  return {
    kind: "exact",
    score: 100,
    mountPriority: 0,
    library: { id: "lib", name: "Lib" },
    substitutions: [],
    unit: { id: "u1", targetText: "电源站", sourceText: "power station" },
  } as unknown as TmMatch;
}

describe("IntelDock stack placement", () => {
  it("shows memory and terms in stacked panes linked to their libraries", () => {
    const onAssets = vi.fn();
    render(
      <IntelDock
        placement="stack"
        onAssets={onAssets}
        intel={{
          ...EMPTY_SEGMENT_INTEL,
          segmentId: "seg-1",
          tm: { matches: [tmMatch()], loading: false, error: null },
          terms: {
            matches: [termMatch("power station", [translation("电源站")])],
            loading: false,
            error: null,
          },
        }}
        collapsed={false}
        onToggle={() => undefined}
        onApplyMatch={() => undefined}
        onInsertTerm={() => undefined}
        onConcordance={() => undefined}
        onQuickAddTerm={() => undefined}
        canQuickAddTerm={false}
        ai={ai}
        onApplyAiProposal={() => undefined}
      />,
    );
    expect(screen.getByTestId("intel-dock")).toHaveAttribute(
      "data-placement",
      "stack",
    );
    expect(screen.getByTestId("intel-dock-split")).toBeInTheDocument();
    expect(screen.getByTestId("apply-match-0")).toBeInTheDocument();
    expect(screen.getByTestId("term-list")).toBeInTheDocument();
    expect(screen.getByTestId("intel-tm-libraries")).toHaveTextContent("Lib");
    expect(screen.getByTestId("intel-tb-libraries")).toHaveTextContent("tb");
    expect(screen.getByTestId("intel-open-tm")).toBeInTheDocument();
    expect(screen.getByTestId("intel-open-tb")).toBeInTheDocument();
  });

  it("opens the asset hub from either stacked pane", async () => {
    const user = userEvent.setup();
    const onAssets = vi.fn();
    render(
      <IntelDock
        placement="stack"
        onAssets={onAssets}
        intel={{
          ...EMPTY_SEGMENT_INTEL,
          segmentId: "seg-1",
          tm: { matches: [tmMatch()], loading: false, error: null },
          terms: {
            matches: [termMatch("power station", [translation("电源站")])],
            loading: false,
            error: null,
          },
        }}
        collapsed={false}
        onToggle={() => undefined}
        onApplyMatch={() => undefined}
        onInsertTerm={() => undefined}
        onConcordance={() => undefined}
        onQuickAddTerm={() => undefined}
        canQuickAddTerm={false}
        ai={ai}
        onApplyAiProposal={() => undefined}
      />,
    );
    await user.click(screen.getByTestId("intel-open-tm"));
    await user.click(screen.getByTestId("intel-open-tb"));
    expect(onAssets).toHaveBeenCalledTimes(2);
  });
});

describe("TermList", () => {
  it("keeps recognised translations insertable by their visible name", async () => {
    const user = userEvent.setup();
    const { onInsert } = renderTerms([
      termMatch("power station", [translation("电源站", { preferred: true })]),
    ]);
    await user.click(screen.getByRole("tab", { name: /Terms/ }));
    await user.click(screen.getByRole("button", { name: "电源站" }));
    expect(onInsert).toHaveBeenCalledWith("电源站");
  });

  it("filters the current segment as the translator types", async () => {
    const user = userEvent.setup();
    renderTerms([
      termMatch("power station", [translation("电源站")]),
      termMatch("warranty", [translation("质保")]),
    ]);
    await user.click(screen.getByRole("tab", { name: /Terms/ }));
    await user.type(screen.getByTestId("term-search"), "war");
    expect(screen.getByRole("button", { name: "质保" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "电源站" })).not.toBeInTheDocument();
  });

  it("Insert on the list inserts the preferred form of the focused hit", async () => {
    const user = userEvent.setup();
    const { onInsert } = renderTerms([
      termMatch("power station", [
        translation("发电厂", { forbidden: true }),
        translation("电源站", { preferred: true }),
      ]),
    ]);
    await user.click(screen.getByRole("tab", { name: /Terms/ }));
    screen.getByTestId("term-list").focus();
    await user.keyboard("{Insert}");
    expect(onInsert).toHaveBeenCalledWith("电源站");
  });

  it("Enter expands a viewer built from the match we already have", async () => {
    const user = userEvent.setup();
    renderTerms([
      termMatch("power station", [translation("电源站", { preferred: true })]),
    ]);
    await user.click(screen.getByRole("tab", { name: /Terms/ }));
    screen.getByTestId("term-list").focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("term-details-0")).toHaveTextContent(
      "Recognised in this segment",
    );
    expect(screen.getByTestId("term-details-0")).toHaveTextContent("电源站");
  });

  it("hovers a recognised hit onto the source span", async () => {
    const user = userEvent.setup();
    const onHighlightTerm = vi.fn();
    renderTerms(
      [termMatch("power station", [translation("电源站")], 4, 17)],
      { onHighlightTerm },
    );
    await user.click(screen.getByRole("tab", { name: /Terms/ }));
    await user.hover(screen.getByTestId("term-hit-0"));
    expect(onHighlightTerm).toHaveBeenCalledWith({ start: 4, end: 17 });
  });
});
