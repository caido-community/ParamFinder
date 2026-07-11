import {
  type ApiResult,
  type AttackType,
  error,
  ok,
  type Wordlist,
  wordlistAttackTypesUpdateSchema,
  wordlistEnabledUpdateSchema,
  wordlistImportSchema,
  wordlistPathSchema,
} from "shared";

import type { BackendSDK } from "../types/types";
import {
  getWordlistManager,
  WordlistNotFoundError,
} from "../wordlists/wordlists";

export async function getWordlists(
  _: BackendSDK,
): Promise<ApiResult<Wordlist[]>> {
  return ok(await getWordlistManager().getWordlists());
}

export async function clearWordlists(_: BackendSDK): Promise<ApiResult<void>> {
  await getWordlistManager().clearWordlists();
  return ok(undefined);
}

export async function importWordlist(
  _: BackendSDK,
  data: string,
  filename: string,
): Promise<ApiResult<Wordlist>> {
  const input = wordlistImportSchema.safeParse({ data, filename });
  if (!input.success) {
    return error("Wordlist data and filename are required.", "VALIDATION");
  }

  return ok(
    await getWordlistManager().importWordlist(
      input.data.data,
      input.data.filename,
    ),
  );
}

export async function deleteWordlist(
  _: BackendSDK,
  path: string,
): Promise<ApiResult<void>> {
  const input = wordlistPathSchema.safeParse(path);
  if (!input.success) return error("Wordlist path is required.", "VALIDATION");

  try {
    await getWordlistManager().deleteWordlist(input.data);
    return ok(undefined);
  } catch (cause) {
    if (cause instanceof WordlistNotFoundError)
      return error(cause.message, "NOT_FOUND");
    throw cause;
  }
}

export async function setWordlistEnabled(
  _: BackendSDK,
  path: string,
  enabled: boolean,
): Promise<ApiResult<void>> {
  const input = wordlistEnabledUpdateSchema.safeParse({ path, enabled });
  if (!input.success) return error("Invalid wordlist update.", "VALIDATION");

  await getWordlistManager().setEnabled(input.data.path, input.data.enabled);
  return ok(undefined);
}

export async function setWordlistAttackTypes(
  _: BackendSDK,
  path: string,
  attackTypes: AttackType[],
): Promise<ApiResult<void>> {
  const input = wordlistAttackTypesUpdateSchema.safeParse({
    path,
    attackTypes,
  });
  if (!input.success)
    return error("Invalid wordlist attack types.", "VALIDATION");

  await getWordlistManager().setAttackTypes(
    input.data.path,
    input.data.attackTypes,
  );
  return ok(undefined);
}
