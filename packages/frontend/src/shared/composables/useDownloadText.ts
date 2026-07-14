export function useDownloadText(filename: string) {
  function downloadText(value: string) {
    const blob = new Blob([value], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return { downloadText };
}
