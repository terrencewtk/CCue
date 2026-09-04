const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

test("packages a GitHub update config for every macOS target", () => {
  const packageJson = require("../package.json");
  const githubPublisher = packageJson.build.publish.find((entry) => entry.provider === "github");
  const updateResource = packageJson.build.extraResources.find((entry) => entry.to === "app-update.yml");

  assert.ok(githubPublisher, "GitHub publisher must be configured");
  assert.deepEqual(updateResource, {
    from: "assets/app-update.yml",
    to: "app-update.yml"
  });

  const updateConfig = fs.readFileSync(path.join(projectRoot, updateResource.from), "utf8");
  assert.match(updateConfig, /^provider: github$/m);
  assert.match(updateConfig, new RegExp(`^owner: ${githubPublisher.owner}$`, "m"));
  assert.match(updateConfig, new RegExp(`^repo: ${githubPublisher.repo}$`, "m"));
  assert.match(updateConfig, /^updaterCacheDirName: ccue-updater$/m);
});
