import type { AiProvider } from "./types";
import { isValidAiModelId } from "./ai-providers";

export function modelOverrideAfterProviderChange(
  currentProvider: AiProvider,
  nextProvider: AiProvider,
  currentModel: string,
) {
  return currentProvider === nextProvider && isValidAiModelId(currentModel) ? currentModel : "";
}
