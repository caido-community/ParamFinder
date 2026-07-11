import { defineStore } from "pinia";
import type { AttackType } from "shared";
import { ref } from "vue";

export type AdvancedScanResult = {
  attackType: AttackType;
  customValue?: string;
  jsonBodyPath?: string;
  cacheBusterParameter?: boolean;
  maxParametersAmount?: number;
};

export type AdvancedScanRequest = {
  initialAttackType?: AttackType;
  jsonBody?: string;
  resolve: (result: AdvancedScanResult | undefined) => void;
};

export const useScanDialogStore = defineStore("scanDialog", () => {
  const request = ref<AdvancedScanRequest | undefined>(undefined);

  const open = (options: {
    initialAttackType?: AttackType;
    jsonBody?: string;
  }): Promise<AdvancedScanResult | undefined> => {
    if (request.value !== undefined) {
      request.value.resolve(undefined);
    }
    return new Promise((resolve) => {
      request.value = {
        initialAttackType: options.initialAttackType,
        jsonBody: options.jsonBody,
        resolve,
      };
    });
  };

  const submit = (result: AdvancedScanResult) => {
    request.value?.resolve(result);
    request.value = undefined;
  };

  const cancel = () => {
    request.value?.resolve(undefined);
    request.value = undefined;
  };

  return { request, open, submit, cancel };
});
