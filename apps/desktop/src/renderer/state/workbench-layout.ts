export const WORKBENCH_LAYOUT_KEY = "translunar.renderer.workbench-layout.v2";

export interface WorkbenchLayout {
  fileNavW: number;
  intelW: number;
  previewH: number;
  filesOpen: boolean;
  previewOpen: boolean;
  chatOpen: boolean;
}

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayout = {
  fileNavW: 200,
  intelW: 300,
  previewH: 220,
  filesOpen: true,
  previewOpen: false,
  chatOpen: false,
};

const MIN_FILE = 140;
const MAX_FILE = 360;
const MIN_INTEL = 220;
const MAX_INTEL = 480;
const MIN_PREVIEW = 140;
const MAX_PREVIEW = 480;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeWorkbenchLayout(
  raw: Partial<WorkbenchLayout> | null | undefined,
): WorkbenchLayout {
  return {
    fileNavW: clamp(Number(raw?.fileNavW) || DEFAULT_WORKBENCH_LAYOUT.fileNavW, MIN_FILE, MAX_FILE),
    intelW: clamp(Number(raw?.intelW) || DEFAULT_WORKBENCH_LAYOUT.intelW, MIN_INTEL, MAX_INTEL),
    previewH: clamp(
      Number(raw?.previewH) || DEFAULT_WORKBENCH_LAYOUT.previewH,
      MIN_PREVIEW,
      MAX_PREVIEW,
    ),
    filesOpen: raw?.filesOpen !== false,
    previewOpen: raw?.previewOpen === true,
    chatOpen: raw?.chatOpen === true,
  };
}

export function readWorkbenchLayout(
  storage: Pick<Storage, "getItem"> = localStorage,
): WorkbenchLayout {
  try {
    const raw = storage.getItem(WORKBENCH_LAYOUT_KEY);
    if (!raw) return { ...DEFAULT_WORKBENCH_LAYOUT };
    return normalizeWorkbenchLayout(JSON.parse(raw) as Partial<WorkbenchLayout>);
  } catch {
    return { ...DEFAULT_WORKBENCH_LAYOUT };
  }
}

export function writeWorkbenchLayout(
  next: WorkbenchLayout,
  storage: Pick<Storage, "setItem"> = localStorage,
): WorkbenchLayout {
  const normalized = normalizeWorkbenchLayout(next);
  storage.setItem(WORKBENCH_LAYOUT_KEY, JSON.stringify(normalized));
  return normalized;
}
