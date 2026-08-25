import type { AiProvider } from "./types";

export function modelOverrideAfterProviderChange(
  currentProvider: AiProvider,
  nextProvider: AiProvider,
  currentModel: string,
) {
  return currentProvider === nextProvider ? currentModel : "";
}
