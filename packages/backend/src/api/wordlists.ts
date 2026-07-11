import {
  type ApiResult,
  type AttackType,
  error,
  ok,
  type Wordlist,
} from "shared";

import type { BackendSDK } from "../types/types";
import { getWordlistManager } from "../wordlists/wordlists";

export async function getWordlists(
  _: BackendSDK,
): Promise<ApiResult<Wordlist[]>> {
  try {
    return ok(await getWordlistManager().getWordlists());
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : String(cause), "IO");
  }
}

export async function clearWordlists(_: BackendSDK): Promise<ApiResult<void>> {
  try {
    await getWordlistManager().clearWordlists();
    return ok(undefined);
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : String(cause), "IO");
  }
}

export async function importWordlist(
  _: BackendSDK,
  data: string,
  filename: string,
): Promise<ApiResult<Wordlist>> {
  if (
    typeof data !== "string" ||
    typeof filename !== "string" ||
    !filename.trim()
  ) {
    return error("Wordlist data and filename are required.", "VALIDATION");
  }
  try {
    return ok(await getWordlistManager().importWordlist(data, filename));
  } catch (cause) {
    return error(
      cause instanceof Error ? cause.message : String(cause),
      cause instanceof TypeError ? "VALIDATION" : "IO",
    );
  }
}

export async function deleteWordlist(
  _: BackendSDK,
  id: string,
): Promise<ApiResult<void>> {
  if (!id) return error("Wordlist ID is required.", "VALIDATION");
  try {
    await getWordlistManager().deleteWordlist(id);
    return ok(undefined);
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : String(cause), "IO");
  }
}

export async function setWordlistEnabled(
  _: BackendSDK,
  id: string,
  enabled: boolean,
): Promise<ApiResult<void>> {
  if (!id || typeof enabled !== "boolean")
    return error("Invalid wordlist update.", "VALIDATION");
  try {
    await getWordlistManager().setEnabled(id, enabled);
    return ok(undefined);
  } catch (cause) {
    return error(
      cause instanceof Error ? cause.message : String(cause),
      "NOT_FOUND",
    );
  }
}

export async function setWordlistAttackTypes(
  _: BackendSDK,
  id: string,
  attackTypes: AttackType[],
): Promise<ApiResult<void>> {
  if (!id || !Array.isArray(attackTypes))
    return error("Invalid wordlist attack types.", "VALIDATION");
  try {
    await getWordlistManager().setAttackTypes(id, attackTypes);
    return ok(undefined);
  } catch (cause) {
    return error(
      cause instanceof Error ? cause.message : String(cause),
      cause instanceof TypeError ? "VALIDATION" : "NOT_FOUND",
    );
  }
}
