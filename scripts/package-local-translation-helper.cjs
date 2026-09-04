const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const translationRoot = path.join(projectRoot, "local-translation");
const bundleRoot = path.join(translationRoot, "CCueTranslationHelper.app");
const contentsRoot = path.join(bundleRoot, "Contents");
const executableRoot = path.join(contentsRoot, "MacOS");
const sourceExecutable = path.join(
  translationRoot,
  ".build",
  "release",
  "caption-local-translation"
);
const bundledExecutable = path.join(executableRoot, "caption-local-translation");

fs.rmSync(bundleRoot, { recursive: true, force: true });
fs.mkdirSync(executableRoot, { recursive: true });
fs.copyFileSync(path.join(translationRoot, "Info.plist"), path.join(contentsRoot, "Info.plist"));
fs.copyFileSync(sourceExecutable, bundledExecutable);
fs.chmodSync(bundledExecutable, 0o755);
