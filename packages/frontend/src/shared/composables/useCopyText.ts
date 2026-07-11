import { useClipboard } from "@vueuse/core";

export function useCopyText() {
  const clipboard = useClipboard();

  async function copyText(value: string) {
    await clipboard.copy(value);
  }

  return {
    ...clipboard,
    copyText,
  };
}
