import { readFile, rm, writeFile } from "fs/promises";
import path from "path";

import { type SDK } from "caido:plugin";

import { pathExists } from "./filesystem";

export async function readWordlist(filePath: string): Promise<string[]> {
  const data = String(await readFile(filePath));
  const words = data
    .split("\n")
    .map((word) => word.trim())
    .filter((word) => word !== "");

  return [...new Set(words)];
}

export async function writeToFile(
  sdk: SDK,
  data: string,
  filename: string,
): Promise<string> {
  if (data === "" || filename === "") {
    throw new Error("Data and filename are required");
  }

  const dir = sdk.meta.path();
  if (dir === "") {
    throw new Error("Could not get plugin directory");
  }

  const sanitizedFilename = path.basename(filename);
  const maxAttempts = 100;

  let filePath = path.join(dir, sanitizedFilename);
  let index = 1;
  while (index < maxAttempts) {
    if (!(await pathExists(filePath))) {
      break;
    }

    const ext = path.extname(sanitizedFilename);
    const base = path.basename(sanitizedFilename, ext);
    filePath = path.join(dir, `${base}-${index}${ext}`);
    index++;
  }

  if (index >= maxAttempts) {
    throw new Error("Could not find available filename after maximum attempts");
  }

  await writeFile(filePath, data);

  return filePath;
}

export async function deleteFile(filePath: string): Promise<void> {
  await rm(filePath);
}
