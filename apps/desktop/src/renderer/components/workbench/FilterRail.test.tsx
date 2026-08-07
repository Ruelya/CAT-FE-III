import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import { FilterRail, MATCH_BUCKET_OPTIONS } from "./FilterRail";

afterEach(cleanup);

function renderRail(overrides: Partial<ComponentProps<typeof FilterRail>> = {}) {
  const props = {
    counts: {
      total: 10,
      untranslated: 2,
      draft: 3,
      confirmed: 5,
      openIssues: 1,
    },
    filter: "all" as const,
    onFilterChange: vi.fn(),
    matchBucket: "all" as const,
    onMatchBucketChange: vi.fn(),
    issuePosition: 1,
    issueTotal: 1,
    onNavigateIssue: vi.fn(),
    showChipAxis: true,
    ...overrides,
  };
  return {
    props,
    ...render(
      <LocaleProvider>
        <FilterRail {...props} />
      </LocaleProvider>,
    ),
  };
}

describe("FilterRail", () => {
  it("renders three logical groups: status, match, issues", () => {
    renderRail();
    expect(
      screen.getByRole("group", { name: /segment filters|句段筛选/i }),
    ).toBeTruthy();
    expect(screen.getByLabelText(/match|匹配/i)).toBeTruthy();
    expect(screen.getByLabelText(/issue navigation|问题导航/i)).toBeTruthy();
  });

  it("exposes pressed state on the selected status chip", () => {
    renderRail({ filter: "draft", showChipAxis: false });
    const draft = screen.getByRole("button", { name: /^Draft\s*3$|^草稿/i });
    expect(draft.getAttribute("aria-pressed")).toBe("true");
  });

  it("mounts chip ActiveAxis when showChipAxis is true", () => {
    const { container } = renderRail({ showChipAxis: true, filter: "all" });
    expect(container.querySelectorAll('[data-axis="active"]')).toHaveLength(1);
  });

  it("does not mount chip ActiveAxis when showChipAxis is false", () => {
    const { container } = renderRail({ showChipAxis: false });
    expect(container.querySelectorAll('[data-axis="active"]')).toHaveLength(0);
  });

  it("marks non-all match buckets as disabled (deferred)", () => {
    renderRail();
    const select = screen.getByRole("combobox", {
      name: /^Match$|^匹配$/,
    }) as HTMLSelectElement;
    const deferred = Array.from(select.options).filter(
      (option) => option.value !== "all",
    );
    expect(deferred.length).toBe(MATCH_BUCKET_OPTIONS.length - 1);
    for (const option of deferred) {
      expect(option.disabled).toBe(true);
    }
    expect(select.options[0]?.disabled).toBe(false);
  });

  it("disables issue navigation when there are zero issues", () => {
    renderRail({ issueTotal: 0, issuePosition: 0 });
    expect(
      screen.getByRole("button", { name: "Previous issue" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next issue" })).toBeDisabled();
  });

  it("calls navigateIssue for previous/next", () => {
    const onNavigateIssue = vi.fn();
    renderRail({ onNavigateIssue, issueTotal: 3, issuePosition: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Previous issue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
    expect(onNavigateIssue).toHaveBeenCalledWith(-1);
    expect(onNavigateIssue).toHaveBeenCalledWith(1);
  });

  it("does not render removed rail chrome (search / Exact TM / confirm)", () => {
    const { container } = renderRail();
    expect(container.querySelector(".document-search")).toBeNull();
    expect(container.querySelector(".match-scope")).toBeNull();
    expect(container.querySelector(".confirm-button")).toBeNull();
    expect(container.querySelector(".editor-command-strip")).toBeNull();
  });
});
