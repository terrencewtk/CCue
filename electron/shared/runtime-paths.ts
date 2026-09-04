import path from "node:path";

/** Resolve the root of the compiled Electron bundle from a domain module directory. */
export function electronBuildRoot(domainModuleDirectory: string): string {
  return path.resolve(domainModuleDirectory, "..");
}

/** Resolve the project/app root from a compiled Electron domain module directory. */
export function applicationRoot(domainModuleDirectory: string): string {
  return path.resolve(electronBuildRoot(domainModuleDirectory), "..", "..");
}

export function preloadScriptPath(domainModuleDirectory: string): string {
  return path.join(electronBuildRoot(domainModuleDirectory), "preload.js");
}

export function rendererFilePath(domainModuleDirectory: string, fileName: string): string {
  return path.join(applicationRoot(domainModuleDirectory), "renderer", fileName);
}

export function developmentSidecarPath(domainModuleDirectory: string): string {
  return path.join(
    applicationRoot(domainModuleDirectory),
    "native",
    "target",
    "release",
    "caption-audio-sidecar"
  );
}
