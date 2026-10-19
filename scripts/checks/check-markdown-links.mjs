import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const sources = [resolve(repositoryRoot, "README.md"), resolve(repositoryRoot, "docs")];
const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
const failures = [];

for (const source of sources) {
  for (const file of await markdownFiles(source)) {
    await verifyLinks(file);
  }
}

if (failures.length > 0) {
  console.error("Broken local Markdown links:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Markdown links are valid.");
}

async function markdownFiles(path) {
  if (extname(path) === ".md") {
    return [path];
  }

  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = resolve(path, entry.name);
      if (entry.isDirectory()) {
        return markdownFiles(target);
      }
      return extname(entry.name) === ".md" ? [target] : [];
    })
  );
  return files.flat();
}

async function verifyLinks(file) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(markdownLinkPattern)) {
    const target = match[1]?.trim();
    if (!target || isExternalOrAnchor(target)) {
      continue;
    }

    const [path] = target.split(/[?#]/, 1);
    if (!path) {
      continue;
    }
    const resolved = resolve(dirname(file), path.replace(/^<|>$/g, ""));
    try {
      await access(resolved);
    } catch {
      failures.push(`${relative(repositoryRoot, file)} -> ${target}`);
    }
  }
}

function isExternalOrAnchor(target) {
  return target.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}
