import { useState, type MouseEvent } from "react";
import type {
  Project,
  ProjectAnalyticsSummary,
  ProjectLifecycle,
  ProjectSnapshot,
} from "@translunar/contracts";
import {
  Archive,
  ArrowRight,
  MoreHorizontal,
  Trash2,
} from "lucide-react";

import { useLocale } from "../../i18n/LocaleProvider";
import { ActiveAxis } from "../workbench/ActiveAxis";

export interface ProjectOverview {
  snapshot: ProjectSnapshot;
  analytics: ProjectAnalyticsSummary | null;
}

export interface ProjectCardProps {
  overview: ProjectOverview;
  opening?: boolean;
  focused?: boolean;
  onOpen(overview: ProjectOverview, documentId?: string): Promise<void>;
  onSetLifecycle(project: Project, lifecycle: ProjectLifecycle): void;
  onRecycle(project: Project): void;
}

export function ProjectCard({
  overview,
  opening = false,
  focused = false,
  onOpen,
  onSetLifecycle,
  onRecycle,
}: ProjectCardProps) {
  const { t, formatDate, formatNumber } = useLocale();
  const { snapshot, analytics } = overview;
  const project = snapshot.project;
  const archived = project.lifecycle === "archived";
  const completion = analytics?.progress.completionBasisPoints;
  const blockers =
    analytics?.progress.qaBlockers ?? snapshot.counts.openIssues ?? 0;
  const segments =
    analytics?.progress.totalSegments ?? snapshot.counts.total ?? 0;
  const [menuOpen, setMenuOpen] = useState(false);

  const openProject = (event?: MouseEvent) => {
    event?.stopPropagation();
    void onOpen(overview);
  };

  return (
    <article
      className="project-card"
      data-lifecycle={project.lifecycle}
      data-opening={opening || undefined}
      data-focused={focused || undefined}
      data-project-id={project.id}
    >
      <div className="project-card__echo" aria-hidden="true" />
      {focused ? <ActiveAxis variant="row" /> : null}

      <header className="project-card__header">
        <div className="project-card__titles">
          <h2 className="project-card__title">{project.name}</h2>
          <p className="project-card__meta">
            <span>{project.domain || t("home.general")}</span>
            <span aria-hidden="true"> · </span>
            <span className="num">
              {project.sourceLocale} → {project.targetLocale}
            </span>
          </p>
        </div>
        {archived ? (
          <span className="project-card__badge">{t("home.archivedBadge")}</span>
        ) : null}
      </header>

      <div className="project-card__progress">
        <div
          className="project-card__progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            completion === undefined
              ? undefined
              : Math.round(completion / 100)
          }
          aria-label={t("home.completionAria", { name: project.name })}
        >
          <span
            className="project-card__progress-fill"
            style={{
              inlineSize:
                completion === undefined
                  ? "0%"
                  : `${Math.min(100, completion / 100)}%`,
            }}
          />
        </div>
        <strong className="num project-card__progress-value">
          {completion === undefined
            ? t("home.unavailable")
            : formatBasisPoints(completion, formatNumber)}
        </strong>
      </div>

      <div className="project-card__metrics num">
        <span>{t("home.filesCount", { count: snapshot.documents.length })}</span>
        <span>{t("home.segmentsCount", { count: segments })}</span>
        <span
          className="project-card__blockers"
          data-has-blockers={blockers > 0 || undefined}
        >
          {blockers > 0 ? (
            <span className="project-card__lamp" aria-hidden="true" />
          ) : null}
          {t("home.blockersCount", { count: blockers })}
        </span>
      </div>

      <time className="project-card__updated num">
        {formatDate(project.updatedAtMs, { dateStyle: "medium" })}
      </time>

      <div className="project-card__overflow">
        <button
          type="button"
          className="icon-button project-card__menu-trigger"
          aria-label={t("home.projectActions", { name: project.name })}
          title={t("home.projectActions", { name: project.name })}
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
          onBlur={(event) => {
            if (
              !event.currentTarget.parentElement?.contains(
                event.relatedTarget as Node,
              )
            ) {
              setMenuOpen(false);
            }
          }}
        >
          <MoreHorizontal size={15} />
        </button>
        {menuOpen ? (
          <div className="project-card__menu" role="menu">
            <button
              type="button"
              role="menuitem"
              disabled={!snapshot.documents.length}
              onClick={() => {
                setMenuOpen(false);
                openProject();
              }}
            >
              {t("home.openProject")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onSetLifecycle(
                  project,
                  archived ? "active" : "archived",
                );
              }}
            >
              <Archive size={13} />
              {archived
                ? t("home.restoreProject")
                : t("home.archiveProject")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                setMenuOpen(false);
                onRecycle(project);
              }}
            >
              <Trash2 size={13} />
              {t("home.moveToRecycle")}
            </button>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="project-card__open"
        disabled={!snapshot.documents.length}
        onClick={openProject}
      >
        {t("home.openProject")}
        <ArrowRight size={14} />
      </button>
    </article>
  );
}

function formatBasisPoints(
  value: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  return `${formatNumber(value / 100, { maximumFractionDigits: 1 })}%`;
}
