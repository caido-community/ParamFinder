export interface AtomicFilePersistence {
  writeFile: (filePath: string, data: string) => Promise<void>;
  replaceFile?: (from: string, to: string) => Promise<void>;
  removeFile?: (filePath: string) => Promise<void>;
}

export async function writeFileAtomically(
  filePath: string,
  data: string,
  persistence: AtomicFilePersistence,
): Promise<void> {
  if (persistence.replaceFile === undefined) {
    await persistence.writeFile(filePath, data);
    return;
  }

  const temporaryPath = `${filePath}.tmp`;
  try {
    await persistence.writeFile(temporaryPath, data);
    await persistence.replaceFile(temporaryPath, filePath);
  } catch (cause) {
    await persistence.removeFile?.(temporaryPath).catch(() => undefined);
    throw cause;
  }
}
