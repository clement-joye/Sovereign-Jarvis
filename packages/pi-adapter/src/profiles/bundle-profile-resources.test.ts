import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  bundlePluginResources,
  updateAcceptedResources
} from "../../../../scripts/runtime/bundle-profile-resources.mjs";
import { buildProfileResourceBundle } from "../../../../scripts/runtime/build-profile-resource-bundle.mjs";

describe("profile resource bundler", () => {
  it("maps the conventional plugin resources tree to stable runtime paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-resource-bundle-"));
    const pluginRoot = join(root, "plugin");
    const outputRoot = join(root, "profile");
    await mkdir(join(pluginRoot, "resources/sample/skills/sample-repository"), { recursive: true });
    await writeFile(join(pluginRoot, "resources/sample/AGENTS.md"), "agent");
    await writeFile(
      join(pluginRoot, "resources/sample/skills/sample-repository/SKILL.md"),
      "skill"
    );
    const targets = await bundlePluginResources({
      pluginRoot,
      outputRoot
    });
    expect(targets).toEqual(["sample"]);

    await expect(readFile(join(outputRoot, "sample/AGENTS.md"), "utf8")).resolves.toBe("agent");
    await expect(
      readFile(join(outputRoot, "sample/skills/sample-repository/SKILL.md"), "utf8")
    ).resolves.toBe("skill");
  });

  it("adds bundled plugin targets to accepted resources exactly once", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-accepted-resources-"));
    const acceptedPath = join(root, "accepted-resources.txt");
    await writeFile(acceptedPath, "brain/AGENTS.md\ngit/AGENTS.md\n");

    await updateAcceptedResources(acceptedPath, [
      "git/AGENTS.md",
      "git/skills",
      "fixture/AGENTS.md"
    ]);
    await updateAcceptedResources(acceptedPath, ["git/AGENTS.md", "git/skills"]);

    await expect(readFile(acceptedPath, "utf8")).resolves.toBe(
      "brain/AGENTS.md\ngit/AGENTS.md\ngit/skills\nfixture/AGENTS.md\n"
    );
  });

  it("publishes only reviewed role prompts and skills with a deterministic digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-profile-resource-bundle-"));
    const profileRoot = join(root, "profile-source");
    const pluginsRoot = join(root, "plugins");
    const outputRoot = join(root, "runtime-profile");
    await mkdir(profileRoot, { recursive: true });
    await mkdir(join(pluginsRoot, "core", "resources/brain/skills/tasks"), { recursive: true });
    await mkdir(join(pluginsRoot, "core", "resources/extensions"), { recursive: true });
    await writeFile(join(profileRoot, "accepted-resources.txt"), "brain/AGENTS.md\nbrain/skills\n");
    await writeFile(
      join(profileRoot, "classification.json"),
      JSON.stringify({
        resources: {
          "brain/AGENTS.md": { compatibility: "sdk-compatible" },
          "brain/skills": { compatibility: "sdk-compatible" }
        }
      })
    );
    await writeFile(join(pluginsRoot, "core/resources/brain/AGENTS.md"), "brain prompt\n");
    await writeFile(
      join(pluginsRoot, "core/resources/brain/skills/tasks/SKILL.md"),
      "task skill\n"
    );
    await writeFile(join(pluginsRoot, "core/resources/extensions/ignored.ts"), "executable\n");

    const first = await buildProfileResourceBundle({ profileRoot, pluginsRoot, outputRoot });
    expect(first.reused).toBe(false);
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.files).toEqual(["brain/AGENTS.md", "brain/skills/tasks/SKILL.md"]);
    const artifactRoot = join(outputRoot, first.artifactName);
    await expect(readFile(join(artifactRoot, "brain/AGENTS.md"), "utf8")).resolves.toBe(
      "brain prompt\n"
    );
    await expect(readFile(join(artifactRoot, "brain/skills/tasks/SKILL.md"), "utf8")).resolves.toBe(
      "task skill\n"
    );
    await expect(lstat(join(artifactRoot, "extensions/ignored.ts"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    const inode = (await lstat(join(artifactRoot, "brain/AGENTS.md"))).ino;
    const second = await buildProfileResourceBundle({ profileRoot, pluginsRoot, outputRoot });
    expect(second).toMatchObject({ digest: first.digest, files: first.files, reused: true });
    expect((await lstat(join(artifactRoot, "brain/AGENTS.md"))).ino).toBe(inode);
  });

  it("rejects unaccepted resources and symlinks before publishing", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-profile-resource-rejections-"));
    const profileRoot = join(root, "profile-source");
    const pluginsRoot = join(root, "plugins");
    const outputRoot = join(root, "runtime-profile");
    await mkdir(profileRoot, { recursive: true });
    await mkdir(join(pluginsRoot, "core", "resources/brain/skills"), { recursive: true });
    await writeFile(join(profileRoot, "accepted-resources.txt"), "brain/AGENTS.md\nbrain/skills\n");
    await writeFile(
      join(profileRoot, "classification.json"),
      JSON.stringify({
        resources: {
          "brain/AGENTS.md": { compatibility: "sdk-compatible" },
          "brain/skills": { compatibility: "sdk-compatible" }
        }
      })
    );
    await writeFile(join(pluginsRoot, "core/resources/brain/AGENTS.md"), "prompt\n");
    await writeFile(join(pluginsRoot, "core/resources/brain/unreviewed.txt"), "nope\n");
    await expect(
      buildProfileResourceBundle({ profileRoot, pluginsRoot, outputRoot })
    ).rejects.toThrow("Unaccepted plugin resource");
    await rm(join(pluginsRoot, "core/resources/brain/unreviewed.txt"));
    await symlink(
      join(pluginsRoot, "core/resources/brain/AGENTS.md"),
      join(pluginsRoot, "core/resources/brain/linked.md")
    );
    await expect(
      buildProfileResourceBundle({ profileRoot, pluginsRoot, outputRoot })
    ).rejects.toThrow("symlink");
  });
});
