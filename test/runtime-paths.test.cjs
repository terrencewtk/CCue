const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  applicationRoot,
  developmentSidecarPath,
  electronBuildRoot,
  preloadScriptPath,
  rendererFilePath
} = require("../build/electron/shared/runtime-paths.js");

test("resolves shared runtime files from a compiled domain directory", () => {
  const projectRoot = path.resolve("/tmp/ccue");
  const domainDirectory = path.join(projectRoot, "build", "electron", "ui");

  assert.equal(electronBuildRoot(domainDirectory), path.join(projectRoot, "build", "electron"));
  assert.equal(applicationRoot(domainDirectory), projectRoot);
  assert.equal(
    preloadScriptPath(domainDirectory),
    path.join(projectRoot, "build", "electron", "preload.js")
  );
  assert.equal(
    rendererFilePath(domainDirectory, "control.html"),
    path.join(projectRoot, "renderer", "control.html")
  );
  assert.equal(
    developmentSidecarPath(domainDirectory),
    path.join(projectRoot, "native", "target", "release", "caption-audio-sidecar")
  );
});
