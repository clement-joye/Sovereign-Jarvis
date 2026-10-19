import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const MAX_GREP_FILES = 100;
const MAX_FILE_BYTES = 256 * 1024;
const IGNORED_SEARCH_DIRECTORIES = new Set([".git", "node_modules"]);

/** Performs a bounded text search without traversing dependency or VCS storage. */
export async function grepWorkspace(root: string, query: string): Promise<string[]> {
  const matches: string[] = [];
  const pending = [root];
  let filesRead = 0;

  while (pending.length > 0 && filesRead < MAX_GREP_FILES) {
    const directory = pending.pop();
    if (!directory) continue;
    const { directories, files } = await listSearchTargets(directory);
    pending.push(...directories);
    for (const target of files) {
      if (filesRead >= MAX_GREP_FILES) break;
      filesRead += 1;
      const content = await readSearchableFile(target);
      if (content !== undefined) matches.push(...matchesInText(root, target, content, query));
    }
  }
  return matches;
}

async function listSearchTargets(
  directory: string
): Promise<{ directories: string[]; files: string[] }> {
  const directories: string[] = [];
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory() && !IGNORED_SEARCH_DIRECTORIES.has(entry.name)) {
      directories.push(target);
    } else if (entry.isFile()) {
      files.push(target);
    }
  }
  return { directories, files };
}

async function readSearchableFile(target: string): Promise<string | undefined> {
  const content = await readFile(target, "utf8");
  return Buffer.byteLength(content) <= MAX_FILE_BYTES ? content : undefined;
}

function matchesInText(root: string, target: string, content: string, query: string): string[] {
  const displayPath = relative(root, target) || ".";
  return content
    .split("\n")
    .flatMap((line, index) =>
      line.includes(query) ? [`${displayPath}:${index + 1}:${line}`] : []
    );
}
