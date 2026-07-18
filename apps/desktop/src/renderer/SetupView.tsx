import { useState, type FormEvent } from "react";
import { ArrowRight, FileText, FolderOpen, Languages } from "lucide-react";

import { BrandMark } from "./BrandMark";
import { fileName, formatError } from "./workbench-utils";

interface SetupViewProps {
  onCreated(projectId: string, documentId: string): Promise<void>;
}

export function SetupView({ onCreated }: SetupViewProps) {
  const [name, setName] = useState("Craft Contracts 2026");
  const [sourceLocale, setSourceLocale] = useState("en-US");
  const [targetLocale, setTargetLocale] = useState("zh-CN");
  const [domain, setDomain] = useState("Legal");
  const [sourcePath, setSourcePath] = useState("");
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseSource = async () => {
    const selected = await window.translunar.selectSourceDocx();
    if (selected) setSourcePath(selected);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sourcePath) {
      setError("Choose a source DOCX before creating the project.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let projectId = createdProjectId;
      if (!projectId) {
        const project = await window.translunar.invoke("project.create", {
          name,
          sourceLocale,
          targetLocale,
          domain,
        });
        projectId = project.id;
        setCreatedProjectId(project.id);
      }
      const document = await window.translunar.invoke("document.importDocx", {
        projectId,
        sourcePath,
      });
      await onCreated(projectId, document.id);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-shell">
      <header className="setup-header">
        <div className="identity-lockup">
          <BrandMark />
          <div>
            <strong>Translunar</strong>
            <span>Computer-assisted translation</span>
          </div>
        </div>
        <span className="setup-header-meta">Local workspace</span>
      </header>
      <div className="translunar-band" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <main className="setup-main">
        <aside className="setup-index" aria-hidden="true">
          <span className="setup-number">01</span>
          <div className="setup-dots" />
          <Languages size={22} strokeWidth={1.4} />
        </aside>
        <section className="setup-content">
          <div className="setup-heading">
            <p>New project</p>
            <h1>Prepare a bilingual workspace</h1>
          </div>
          <form className="setup-form" onSubmit={submit}>
            <label className="field field-wide">
              <span>Project name</span>
              <input
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                required
              />
            </label>
            <label className="field">
              <span>Source language</span>
              <select
                value={sourceLocale}
                onChange={(event) => setSourceLocale(event.currentTarget.value)}
              >
                <option value="en-US">English (United States)</option>
                <option value="en-GB">English (United Kingdom)</option>
                <option value="zh-CN">Chinese (Simplified)</option>
              </select>
            </label>
            <label className="field">
              <span>Target language</span>
              <select
                value={targetLocale}
                onChange={(event) => setTargetLocale(event.currentTarget.value)}
              >
                <option value="zh-CN">Chinese (Simplified)</option>
                <option value="zh-TW">Chinese (Traditional)</option>
                <option value="en-US">English (United States)</option>
              </select>
            </label>
            <label className="field field-wide">
              <span>Domain</span>
              <input
                value={domain}
                onChange={(event) => setDomain(event.currentTarget.value)}
              />
            </label>
            <div className="source-picker field-wide">
              <div className="source-picker-icon">
                <FileText size={22} strokeWidth={1.5} />
              </div>
              <div className="source-picker-copy">
                <span>Source document</span>
                <strong>
                  {sourcePath ? fileName(sourcePath) : "No DOCX selected"}
                </strong>
              </div>
              <button
                className="button secondary"
                type="button"
                onClick={chooseSource}
              >
                <FolderOpen size={15} />
                Choose file
              </button>
            </div>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="setup-actions field-wide">
              <span className="setup-note">SQLite workspace · local files</span>
              <button className="button primary" type="submit" disabled={busy}>
                {busy ? "Preparing" : "Create and import"}
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </section>
        <aside className="setup-aside">
          <div className="setup-aside-rule" />
          <span>DOCX</span>
          <span>EN → ZH-CN</span>
          <span>LOCAL</span>
        </aside>
      </main>
    </div>
  );
}
