/**
 * Main-process Electron dialog title catalog.
 * Shared with renderer i18n so dialog.* keys stay in sync.
 */

export type DialogLocale = "en-US" | "zh-CN";

export type DialogMessageKey =
  | "dialog.selectSource"
  | "dialog.selectSources"
  | "dialog.selectSourceFolder"
  | "dialog.selectProjectArchive"
  | "dialog.selectProjectArchiveDestination"
  | "dialog.selectExport"
  | "dialog.selectExportTaskPackage"
  | "dialog.selectInteropReview"
  | "dialog.selectInteropTable"
  | "dialog.selectTaskPackageInput"
  | "dialog.selectCorpusInput"
  | "dialog.selectPluginPackage"
  | "dialog.selectDataDirectory"
  | "dialog.selectBackupDestination"
  | "dialog.selectRestoreSource";

type DialogCatalog = Record<DialogMessageKey, string>;

const enUs: DialogCatalog = {
  "dialog.selectSource": "Import source document",
  "dialog.selectSources": "Add source documents",
  "dialog.selectSourceFolder": "Add a source folder",
  "dialog.selectProjectArchive": "Restore a Translunar project",
  "dialog.selectProjectArchiveDestination": "Export Translunar project archive",
  "dialog.selectExport": "Export Translunar file",
  "dialog.selectExportTaskPackage": "Export offline task package",
  "dialog.selectInteropReview": "Open bilingual review DOCX",
  "dialog.selectInteropTable": "Open bilingual table",
  "dialog.selectTaskPackageInput": "Open offline task package",
  "dialog.selectCorpusInput": "Import reference corpus",
  "dialog.selectPluginPackage": "Select plugin package directory",
  "dialog.selectDataDirectory": "Choose data directory",
  "dialog.selectBackupDestination": "Choose backup destination parent folder",
  "dialog.selectRestoreSource": "Choose backup folder to restore",
};

const zhCn: DialogCatalog = {
  "dialog.selectSource": "导入源文档",
  "dialog.selectSources": "添加源文档",
  "dialog.selectSourceFolder": "添加源文件夹",
  "dialog.selectProjectArchive": "恢复 Translunar 项目",
  "dialog.selectProjectArchiveDestination": "导出 Translunar 项目归档",
  "dialog.selectExport": "导出 Translunar 文件",
  "dialog.selectExportTaskPackage": "导出离线任务包",
  "dialog.selectInteropReview": "打开双语审阅 DOCX",
  "dialog.selectInteropTable": "打开双语对照表",
  "dialog.selectTaskPackageInput": "打开离线任务包",
  "dialog.selectCorpusInput": "导入参考语料",
  "dialog.selectPluginPackage": "选择插件包目录",
  "dialog.selectDataDirectory": "选择数据目录",
  "dialog.selectBackupDestination": "选择备份目标父文件夹",
  "dialog.selectRestoreSource": "选择要恢复的备份文件夹",
};

const catalogs: Record<DialogLocale, DialogCatalog> = {
  "en-US": enUs,
  "zh-CN": zhCn,
};

const DIALOG_KEYS = Object.keys(enUs) as DialogMessageKey[];

export function listDialogMessageKeys(): DialogMessageKey[] {
  return [...DIALOG_KEYS];
}

export function normalizeDialogLocale(
  value: string | null | undefined,
): DialogLocale {
  if (!value) return "en-US";
  const lower = value.toLocaleLowerCase();
  if (lower.startsWith("zh")) return "zh-CN";
  return "en-US";
}

export function dialogTitle(
  locale: string | null | undefined,
  key: DialogMessageKey,
): string {
  const normalized = normalizeDialogLocale(locale);
  return catalogs[normalized][key] ?? catalogs["en-US"][key] ?? key;
}
