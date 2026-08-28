import type { Document, SegmentCounts } from "@translunar/contracts";

/**
 * The file explorer's tree.
 *
 * Documents carry a relativePath from the import, so the folders here are the
 * ones the source material actually had — nothing is invented to make the
 * tree look deeper. A flat import stays a flat list, which is the honest
 * rendering of a flat project.
 */

export interface DocTreeFile {
  kind: "file";
  /** Stable across renders so expand state survives a reload. */
  key: string;
  depth: number;
  document: Document;
}

export interface DocTreeDir {
  kind: "dir";
  key: string;
  depth: number;
  name: string;
  /** Documents anywhere beneath this folder. */
  fileCount: number;
  /** Counts rolled up from every document beneath, when they are known. */
  rollup: SegmentCounts | null;
}

export type DocTreeNode = DocTreeFile | DocTreeDir;

interface Dir {
  name: string;
  key: string;
  dirs: Map<string, Dir>;
  files: Document[];
}

function emptyDir(name: string, key: string): Dir {
  return { name, key, dirs: new Map(), files: [] };
}

/** Directory segments of a document's path, without the file name itself. */
function rawSegmentsOf(document: Document): string[] {
  const path =
    typeof document.relativePath === "string" ? document.relativePath : "";
  return path
    .split(/[/\\]/)
    .slice(0, -1)
    .filter((part) => part.length > 0 && part !== ".");
}

/**
 * Folders every document shares carry no information — the import records the
 * absolute source path, so without this a two-file project would render the
 * reader's home directory as four nested folders. What survives the shared
 * prefix is exactly the structure that tells the documents apart, which is
 * the only structure worth indenting for. A lone document therefore has
 * nothing to be distinguished from and renders at the root.
 */
function sharedPrefixLength(documents: readonly Document[]): number {
  const paths = documents.map(rawSegmentsOf);
  const first = paths[0];
  if (!first) {
    return 0;
  }
  let shared = first.length;
  for (const path of paths.slice(1)) {
    let i = 0;
    while (i < shared && i < path.length && path[i] === first[i]) {
      i += 1;
    }
    shared = i;
  }
  return shared;
}

function addCounts(
  into: SegmentCounts | null,
  from: SegmentCounts | undefined,
): SegmentCounts | null {
  if (!from) {
    return into;
  }
  if (!into) {
    return { ...from };
  }
  return {
    total: into.total + from.total,
    confirmed: into.confirmed + from.confirmed,
    draft: into.draft + from.draft,
    untranslated: into.untranslated + from.untranslated,
    openIssues: into.openIssues + from.openIssues,
  };
}

/**
 * Flattens the documents into the rows the explorer renders, in display
 * order: folders before files at each level, both alphabetical, with a
 * collapsed folder hiding everything beneath it.
 *
 * `prefixDocuments` is the list the shared prefix is measured on. A search
 * passes the full document list here while rendering only the hits, so
 * narrowing to one folder keeps that folder's row on screen instead of
 * re-flattening the survivors to the root.
 */
export function buildDocTree(
  documents: readonly Document[],
  progress: Readonly<Record<string, SegmentCounts>>,
  collapsed: ReadonlySet<string>,
  prefixDocuments: readonly Document[] = documents,
): DocTreeNode[] {
  const root = emptyDir("", "");
  const skip = sharedPrefixLength(prefixDocuments);
  for (const document of documents) {
    let dir = root;
    for (const segment of rawSegmentsOf(document).slice(skip)) {
      const key = dir.key ? `${dir.key}/${segment}` : segment;
      let next = dir.dirs.get(segment);
      if (!next) {
        next = emptyDir(segment, key);
        dir.dirs.set(segment, next);
      }
      dir = next;
    }
    dir.files.push(document);
  }

  const rows: DocTreeNode[] = [];
  const byName = (a: string, b: string) => a.localeCompare(b, "zh-Hans-CN");

  const walk = (dir: Dir, depth: number): void => {
    for (const name of [...dir.dirs.keys()].sort(byName)) {
      const child = dir.dirs.get(name)!;
      const { count, rollup } = summarize(child, progress);
      rows.push({
        kind: "dir",
        key: child.key,
        depth,
        name,
        fileCount: count,
        rollup,
      });
      if (!collapsed.has(child.key)) {
        walk(child, depth + 1);
      }
    }
    for (const document of [...dir.files].sort((a, b) =>
      byName(a.name, b.name),
    )) {
      rows.push({
        kind: "file",
        key: `file:${document.id}`,
        depth,
        document,
      });
    }
  };

  walk(root, 0);
  return rows;
}

function summarize(
  dir: Dir,
  progress: Readonly<Record<string, SegmentCounts>>,
): { count: number; rollup: SegmentCounts | null } {
  let count = dir.files.length;
  let rollup: SegmentCounts | null = null;
  for (const document of dir.files) {
    rollup = addCounts(rollup, progress[document.id]);
  }
  for (const child of dir.dirs.values()) {
    const inner = summarize(child, progress);
    count += inner.count;
    if (inner.rollup) {
      rollup = addCounts(rollup, inner.rollup);
    }
  }
  return { count, rollup };
}

/**
 * What the explorer's search matches: the path exactly as the tree draws
 * it — the folders that survive the shared-prefix strip, then the file
 * name. Typing a visible folder name therefore narrows to that folder's
 * contents, and the stripped prefix (the reader's home directory) can never
 * produce a hit the tree has no row for.
 */
export function docTreeDisplayPaths(
  documents: readonly Document[],
): Map<string, string> {
  const skip = sharedPrefixLength(documents);
  const paths = new Map<string, string>();
  for (const document of documents) {
    const segments = rawSegmentsOf(document).slice(skip);
    paths.set(document.id, [...segments, document.name].join("/"));
  }
  return paths;
}

/** Every directory key in the tree, for expand-all / collapse-all. */
export function docTreeDirKeys(
  documents: readonly Document[],
  prefixDocuments: readonly Document[] = documents,
): string[] {
  const keys = new Set<string>();
  const skip = sharedPrefixLength(prefixDocuments);
  for (const document of documents) {
    let prefix = "";
    for (const segment of rawSegmentsOf(document).slice(skip)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      keys.add(prefix);
    }
  }
  return [...keys];
}
