import {
  isInjectableJsonBodyPath,
  parseJsonBodyPath,
} from "@paramfinder/engine";
import { useLocalStorage } from "@vueuse/core";
import type { AttackType } from "shared";
import { computed, nextTick, ref, watch } from "vue";

import {
  type AdvancedScanCache,
  advancedScanCacheKey,
  createAdvancedScanCache,
  createAdvancedScanFormValues,
  createAdvancedScanResult,
} from "@/features/scan/lib/advancedScanForm";
import { evaluateJsonBody } from "@/features/scan/lib/evaluateJsonBody";
import type { AdvancedScanRequest } from "@/features/scan/stores/scanDialog";

export function useAdvancedScanForm() {
  const cache = useLocalStorage<AdvancedScanCache>(advancedScanCacheKey, {});
  const attackType = ref<AttackType>("query");
  const customValue = ref("");
  const jsonBodyPath = ref("");
  const cacheBusterParameter = ref(false);
  const maxParametersAmount = ref<number | undefined>(undefined);
  const bodyState = ref(evaluateJsonBody());
  const treeOpen = ref(false);

  const canPickPath = computed(() => bodyState.value.kind === "valid");
  const jsonPathError = computed(() => {
    if (attackType.value !== "body" || jsonBodyPath.value.trim() === "") {
      return undefined;
    }
    try {
      parseJsonBodyPath(jsonBodyPath.value);
    } catch {
      return "Enter a valid JSON path.";
    }
    if (bodyState.value.kind !== "valid") {
      return "A JSON path requires a valid JSON object request body.";
    }
    if (!isInjectableJsonBodyPath(bodyState.value.value, jsonBodyPath.value)) {
      return "The JSON path must resolve to an object.";
    }
    return undefined;
  });
  const canSubmit = computed(() => jsonPathError.value === undefined);

  const currentValues = () => ({
    attackType: attackType.value,
    customValue: customValue.value,
    jsonBodyPath: jsonBodyPath.value,
    cacheBusterParameter: cacheBusterParameter.value,
    maxParametersAmount: maxParametersAmount.value,
  });

  let suppressPersist = false;

  const reset = (request: AdvancedScanRequest) => {
    const values = createAdvancedScanFormValues(request, cache.value);
    suppressPersist = true;
    attackType.value = values.attackType;
    customValue.value = values.customValue;
    jsonBodyPath.value = values.jsonBodyPath;
    cacheBusterParameter.value = values.cacheBusterParameter;
    maxParametersAmount.value = values.maxParametersAmount;
    bodyState.value = evaluateJsonBody(request.jsonBody);
    treeOpen.value = false;
    void nextTick(() => {
      suppressPersist = false;
    });
  };

  const submitValue = () => {
    cache.value = createAdvancedScanCache(currentValues());
    return createAdvancedScanResult(currentValues());
  };

  const toggleTree = () => {
    if (!canPickPath.value) {
      return;
    }
    treeOpen.value = !treeOpen.value;
  };

  const selectTreePath = (path: string) => {
    jsonBodyPath.value = path;
    treeOpen.value = false;
  };

  watch(
    [
      attackType,
      customValue,
      jsonBodyPath,
      cacheBusterParameter,
      maxParametersAmount,
    ],
    () => {
      if (!suppressPersist) {
        cache.value = createAdvancedScanCache(currentValues());
      }
    },
  );

  watch(attackType, () => {
    if (attackType.value !== "body") {
      treeOpen.value = false;
    }
  });

  return {
    attackType,
    customValue,
    jsonBodyPath,
    cacheBusterParameter,
    maxParametersAmount,
    bodyState,
    treeOpen,
    canPickPath,
    jsonPathError,
    canSubmit,
    reset,
    submitValue,
    toggleTree,
    selectTreePath,
  };
}
