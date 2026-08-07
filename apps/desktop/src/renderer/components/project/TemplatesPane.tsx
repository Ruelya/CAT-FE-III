import type { ProjectTemplate } from "@translunar/contracts";
import { FileText, Plus, Trash2 } from "lucide-react";

import { useLocale } from "../../i18n/LocaleProvider";
import { readTemplateDefinition } from "../../project-home-utils";

export interface TemplatesPaneProps {
  templates: ProjectTemplate[];
  onCreate(): void;
  onEdit(template: ProjectTemplate): void;
  onDelete(template: ProjectTemplate): void;
}

export function TemplatesPane({
  templates,
  onCreate,
  onEdit,
  onDelete,
}: TemplatesPaneProps) {
  const { t, formatDate } = useLocale();

  return (
    <div className="templates-pane">
      <header className="project-view-heading">
        <div>
          <h1>{t("home.projectTemplates")}</h1>
        </div>
        <button className="button primary" type="button" onClick={onCreate}>
          <Plus size={15} /> {t("home.newTemplate")}
        </button>
      </header>
      {templates.length === 0 ? (
        <div className="project-home-empty" data-empty="d6">
          <FileText size={22} aria-hidden="true" />
          <strong>{t("home.templatesEmpty")}</strong>
          <span>{t("home.templatesEmptyHelp")}</span>
          <button className="button primary" type="button" onClick={onCreate}>
            <Plus size={15} /> {t("home.newTemplate")}
          </button>
        </div>
      ) : (
        <div className="template-list">
          {templates.map((template) => {
            const definition = readTemplateDefinition(template.definition);
            return (
              <article key={template.id}>
                <header>
                  <div>
                    <span>
                      {template.builtIn ? t("home.builtIn") : t("home.custom")}{" "}
                      · {t("home.revision", { revision: template.revision })}
                    </span>
                    <h2>{template.name}</h2>
                  </div>
                  <FileText size={18} aria-hidden="true" />
                </header>
                <p>{template.description || t("home.noDescription")}</p>
                <dl>
                  <div>
                    <dt>{t("home.locales")}</dt>
                    <dd>
                      {definition.sourceLocale} → {definition.targetLocale}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("common.domain")}</dt>
                    <dd>{definition.domain || t("home.general")}</dd>
                  </div>
                  <div>
                    <dt>{t("home.analysis")}</dt>
                    <dd>{definition.analysisProfileId}</dd>
                  </div>
                  <div>
                    <dt>{t("home.review")}</dt>
                    <dd>
                      {definition.reviewRequired
                        ? t("home.required")
                        : t("home.optional")}
                    </dd>
                  </div>
                </dl>
                <footer>
                  <time>
                    {t("home.updated", {
                      value: formatDate(template.updatedAtMs, {
                        dateStyle: "medium",
                      }),
                    })}
                  </time>
                  {!template.builtIn ? (
                    <div>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => onEdit(template)}
                      >
                        {t("common.edit")}
                      </button>
                      <button
                        className="icon-button danger"
                        type="button"
                        aria-label={t("home.deleteTemplateNamed", {
                          name: template.name,
                        })}
                        title={t("home.deleteTemplate")}
                        onClick={() => onDelete(template)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : null}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
