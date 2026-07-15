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

import {
  WordlistNotFoundError,
  type WordlistsService,
} from "../services/wordlists";
import type { BackendSDK } from "../types";

export function createWordlistHandlers(wordlists: WordlistsService) {
  const getWordlists = async (
    _sdk: BackendSDK,
  ): Promise<ApiResult<Wordlist[]>> => ok(await wordlists.getWordlists());

  const clearWordlists = async (_sdk: BackendSDK): Promise<ApiResult<void>> => {
    await wordlists.clearWordlists();
    return ok(undefined);
  };

  const importWordlist = async (
    _sdk: BackendSDK,
    data: string,
    filename: string,
  ): Promise<ApiResult<Wordlist>> => {
    const input = wordlistImportSchema.safeParse({ data, filename });
    if (!input.success) {
      return error("Wordlist data and filename are required.", "VALIDATION");
    }
    return ok(
      await wordlists.importWordlist(input.data.data, input.data.filename),
    );
  };

  const deleteWordlist = async (
    _sdk: BackendSDK,
    path: string,
  ): Promise<ApiResult<void>> => {
    const input = wordlistPathSchema.safeParse(path);
    if (!input.success) {
      return error("Wordlist path is required.", "VALIDATION");
    }

    try {
      await wordlists.deleteWordlist(input.data);
      return ok(undefined);
    } catch (cause) {
      if (cause instanceof WordlistNotFoundError) {
        return error(cause.message, "NOT_FOUND");
      }
      throw cause;
    }
  };

  const setWordlistEnabled = async (
    _sdk: BackendSDK,
    path: string,
    enabled: boolean,
  ): Promise<ApiResult<void>> => {
    const input = wordlistEnabledUpdateSchema.safeParse({ path, enabled });
    if (!input.success) return error("Invalid wordlist update.", "VALIDATION");

    await wordlists.setEnabled(input.data.path, input.data.enabled);
    return ok(undefined);
  };

  const setWordlistAttackTypes = async (
    _sdk: BackendSDK,
    path: string,
    attackTypes: AttackType[],
  ): Promise<ApiResult<void>> => {
    const input = wordlistAttackTypesUpdateSchema.safeParse({
      path,
      attackTypes,
    });
    if (!input.success) {
      return error("Invalid wordlist attack types.", "VALIDATION");
    }

    await wordlists.setAttackTypes(input.data.path, input.data.attackTypes);
    return ok(undefined);
  };

  return {
    clearWordlists,
    deleteWordlist,
    getWordlists,
    importWordlist,
    setWordlistAttackTypes,
    setWordlistEnabled,
  };
}
