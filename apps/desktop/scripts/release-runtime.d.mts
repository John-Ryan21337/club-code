export const releaseRoot: string;
export function assertReleasePath(root: string, candidate: string, name?: string): string;
export function validateReleaseGitStorage(root?: string): void;
export function prepareReleaseCorepackCache(root: string, corepackHome: string): void;
export function buildReleaseRuntimeEnv(
  environment: NodeJS.ProcessEnv,
  root?: string,
): NodeJS.ProcessEnv;
export function prepareReleaseRuntime(
  environment?: NodeJS.ProcessEnv,
  root?: string,
  legacyHome?: string,
): NodeJS.ProcessEnv;
