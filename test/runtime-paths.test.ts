import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  applicationRoot,
  developmentSidecarPath,
  electronBuildRoot,
  preloadScriptPath,
  rendererFilePath
} from "../electron/shared/runtime-paths";

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
