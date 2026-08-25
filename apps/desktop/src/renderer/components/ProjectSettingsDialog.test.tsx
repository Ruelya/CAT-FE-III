import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Project } from "@translunar/contracts";

import { ProjectSettingsDialog } from "./ProjectSettingsDialog.js";

const project: Project = {
  id: "p1",
  name: "演示项目",
  sourceLocale: "en-US",
  targetLocale: "zh-CN",
  domain: "general",
  lifecycle: "active",
  revision: 1,
  createdAtMs: 1,
  updatedAtMs: 1,
  configuration: {},
};

describe("ProjectSettingsDialog", () => {
  it("shows the language pair read-only with an honest explanation", () => {
    render(
      <ProjectSettingsDialog open project={project} onClose={vi.fn()} />,
    );
    expect(screen.getByText("en-US → zh-CN")).toBeInTheDocument();
    expect(screen.getByText(/尚无 project.update/)).toBeInTheDocument();
  });

  it("keeps TM and termbase mount entries disabled instead of faking success", () => {
    render(
      <ProjectSettingsDialog open project={project} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "挂载外部 TM…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "挂载术语库…" })).toBeDisabled();
    expect(screen.getByText(/不做假成功/)).toBeInTheDocument();
  });

  it("renders nothing when closed and closes via the footer button", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ProjectSettingsDialog open={false} project={project} onClose={onClose} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(
      <ProjectSettingsDialog open project={project} onClose={onClose} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalled();
  });
});
