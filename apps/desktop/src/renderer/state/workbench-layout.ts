export const WORKBENCH_LAYOUT_KEY = "translunar.renderer.workbench-layout.v1";

export interface WorkbenchLayout {
  fileNavW: number;
  intelW: number;
  previewW: number;
  filesOpen: boolean;
  previewSide: boolean;
  chatOpen: boolean;
}

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayout = {
  fileNavW: 200,
  intelW: 300,
  previewW: 280,
  filesOpen: true,
  previewSide: true,
  chatOpen: false,
};

const MIN_FILE = 140;
const MAX_FILE = 360;
const MIN_INTEL = 220;
const MAX_INTEL = 480;
const MIN_PREVIEW = 200;
const MAX_PREVIEW = 520;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeWorkbenchLayout(
  raw: Partial<WorkbenchLayout> | null | undefined,
): WorkbenchLayout {
  return {
    fileNavW: clamp(Number(raw?.fileNavW) || DEFAULT_WORKBENCH_LAYOUT.fileNavW, MIN_FILE, MAX_FILE),
    intelW: clamp(Number(raw?.intelW) || DEFAULT_WORKBENCH_LAYOUT.intelW, MIN_INTEL, MAX_INTEL),
    previewW: clamp(
      Number(raw?.previewW) || DEFAULT_WORKBENCH_LAYOUT.previewW,
      MIN_PREVIEW,
      MAX_PREVIEW,
    ),
    filesOpen: raw?.filesOpen !== false,
    previewSide: raw?.previewSide !== false,
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
