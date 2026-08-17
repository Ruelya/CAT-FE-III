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
  | "dialog.selectTmExchange"
  | "dialog.selectTermbaseExchange"
  | "dialog.selectPluginPackage"
  | "dialog.selectDataDirectory"
  | "dialog.selectBackupDestination"
  | "dialog.selectRestoreSource";

/**
 * File-filter display names shown in native open/save dialogs. Separate key
 * space from dialog titles because these label file-type groups, not windows.
 * Format tokens inside the labels (DOCX, XLSX, tltask, …) stay as data.
 */
export type DialogFilterKey =
  | "filter.supportedDocuments"
  | "filter.projectArchives"
  | "filter.htmlReports"
  | "filter.excelWorkbooks"
  | "filter.taskPackages"
  | "filter.sourceFormat"
  | "filter.reviewDocx"
  | "filter.bilingualTables"
  | "filter.tmExchange"
  | "filter.termbaseExchange";

type DialogCatalog = Record<DialogMessageKey, string>;

type DialogFilterCatalog = Record<DialogFilterKey, string>;

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
  "dialog.selectTmExchange": "Import translation memory",
  "dialog.selectTermbaseExchange": "Import termbase",
  "dialog.selectPluginPackage":
    "Select plugin package directory or .tlplugin file",
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
  "dialog.selectTmExchange": "导入翻译记忆库",
  "dialog.selectTermbaseExchange": "导入术语库",
  "dialog.selectPluginPackage": "选择插件包目录或 .tlplugin 文件",
  "dialog.selectDataDirectory": "选择数据目录",
  "dialog.selectBackupDestination": "选择备份目标父文件夹",
  "dialog.selectRestoreSource": "选择要恢复的备份文件夹",
};

const enUsFilters: DialogFilterCatalog = {
  "filter.supportedDocuments": "Supported documents",
  "filter.projectArchives": "Translunar project archives",
  "filter.htmlReports": "HTML reports",
  "filter.excelWorkbooks": "Excel workbooks",
  "filter.taskPackages": "Offline task packages",
  "filter.sourceFormat": "Source format",
  "filter.reviewDocx": "Review DOCX",
  "filter.bilingualTables": "Bilingual tables",
  "filter.tmExchange": "Translation memory (TMX, CSV, TSV)",
  "filter.termbaseExchange": "Termbase (TBX, CSV, TSV)",
};

const zhCnFilters: DialogFilterCatalog = {
  "filter.supportedDocuments": "支持的文档",
  "filter.projectArchives": "Translunar 项目归档",
  "filter.htmlReports": "HTML 报告",
  "filter.excelWorkbooks": "Excel 工作簿",
  "filter.taskPackages": "离线任务包",
  "filter.sourceFormat": "源格式",
  "filter.reviewDocx": "审阅 DOCX",
  "filter.bilingualTables": "双语对照表",
  "filter.tmExchange": "翻译记忆库（TMX、CSV、TSV）",
  "filter.termbaseExchange": "术语库（TBX、CSV、TSV）",
};

const catalogs: Record<DialogLocale, DialogCatalog> = {
  "en-US": enUs,
  "zh-CN": zhCn,
};

const filterCatalogs: Record<DialogLocale, DialogFilterCatalog> = {
  "en-US": enUsFilters,
  "zh-CN": zhCnFilters,
};

const DIALOG_KEYS = Object.keys(enUs) as DialogMessageKey[];

const DIALOG_FILTER_KEYS = Object.keys(enUsFilters) as DialogFilterKey[];

export function listDialogMessageKeys(): DialogMessageKey[] {
  return [...DIALOG_KEYS];
}

export function listDialogFilterKeys(): DialogFilterKey[] {
  return [...DIALOG_FILTER_KEYS];
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

export function dialogFilterName(
  locale: string | null | undefined,
  key: DialogFilterKey,
): string {
  const normalized = normalizeDialogLocale(locale);
  return filterCatalogs[normalized][key] ?? filterCatalogs["en-US"][key] ?? key;
}
