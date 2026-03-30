import { SDK } from "caido:plugin";
import { readFile, rm, writeFile } from "fs/promises";
import path from "path";

/*
  Read a wordlist from a file and return a cleaned up array of strings
*/
export async function readWordlist(path: string) {
  const data = await readFile(path, { encoding: "utf-8" });
  return cleanupWordlist(data.split("\n"));
}

/*
  Deduplicate and remove empty lines from a wordlist
*/
function cleanupWordlist(wordlist: string[]) {
  const seen = new Set<string>();
  return wordlist.reduce((acc: string[], word) => {
    const trimmed = word.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      acc.push(trimmed);
    }
    return acc;
  }, []);
}

/* random string generator */
export const DEFAULT_RANDOM_PARAMETER_VALUE_LENGTH = 10;

export function randomString(length: number) {
  let result = "";
  const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

/* ID generator */
export function generateID() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 7);
  return timestamp.padStart(8, '0') + random;
}

/* Will write a file and return the path */
export async function writeToFile(sdk: SDK, data: string, filename: string) {
  if (!data || !filename) {
    throw new Error("Data and filename are required");
  }

  const sanitizedFilename = path.basename(filename);

  const dir = sdk.meta.path();
  if (!dir) {
    throw new Error("Could not get plugin directory");
  }

  let filePath = path.join(dir, sanitizedFilename);
  let index = 1;
  const maxAttempts = 100;

  while (index < maxAttempts) {
    try {
      await readFile(filePath);
      const ext = path.extname(sanitizedFilename);
      const base = path.basename(sanitizedFilename, ext);
      filePath = path.join(dir, `${base}-${index}${ext}`);
      index++;
    } catch (err) {
      break;
    }
  }

  if (index >= maxAttempts) {
    throw new Error("Could not find available filename after maximum attempts");
  }

  try {
    await writeFile(filePath, data);
    return filePath;
  } catch (err) {
    throw new Error(`Failed to write file: ${err}`);
  }
}

/* delete a file */
export async function deleteFile(sdk: SDK, path: string) {
  await rm(path);
}

/* uint8array to string */
export function uint8ArrayToString(uint8Array: Uint8Array) {
  const chunks: string[] = [];
  const chunkSize = 65535;

  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.slice(i, i + chunkSize);
    chunks.push(String.fromCharCode.apply(null, Array.from(chunk)));
  }

  return chunks.join("");
}

/*
  Get the similarity between two strings
  https://github.com/stephenjjbrown/string-similarity-js/blob/master/src/string-similarity.ts
*/
export const stringSimilarity = (
  str1: string,
  str2: string,
  substringLength: number = 2,
  caseSensitive: boolean = false
) => {
  if (!caseSensitive) {
    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();
  }

  if (str1.length < substringLength || str2.length < substringLength) return 0;

  const map = new Map();
  for (let i = 0; i < str1.length - (substringLength - 1); i++) {
    const substr1 = str1.substr(i, substringLength);
    map.set(substr1, map.has(substr1) ? map.get(substr1) + 1 : 1);
  }

  let match = 0;
  for (let j = 0; j < str2.length - (substringLength - 1); j++) {
    const substr2 = str2.substr(j, substringLength);
    const count = map.has(substr2) ? map.get(substr2) : 0;
    if (count > 0) {
      map.set(substr2, count - 1);
      match++;
    }
  }

  return (match * 2) / (str1.length + str2.length - (substringLength - 1) * 2);
};
