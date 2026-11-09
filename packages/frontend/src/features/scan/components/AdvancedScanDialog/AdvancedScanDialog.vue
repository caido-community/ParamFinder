<script setup lang="ts">
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import SelectButton from "primevue/selectbutton";
import { computed, ref, watch } from "vue";

import JsonPathTree from "./JsonPathTree/JsonPathTree.vue";
import { useAdvancedScanForm } from "./useAdvancedScanForm";

import { useScanDialogStore } from "@/features/scan/stores/scanDialog";
import { attackTypeOptions } from "@/shared/constants/attackTypes";

defineOptions({ name: "AdvancedScanDialog" });

const store = useScanDialogStore();
const {
  attackType,
  customValue,
  jsonBodyPath,
  cacheBusterParameter,
  maxParametersAmount,
  bodyState,
  treeOpen,
  jsonPathError,
  canSubmit,
  reset,
  submitValue,
  selectTreePath,
} = useAdvancedScanForm();

const customValueInput = ref<{ $el: HTMLInputElement } | undefined>(undefined);

const visible = computed({
  get: () => store.request !== undefined,
  set: (value) => {
    if (!value) {
      store.cancel();
    }
  },
});

watch(
  () => store.request,
  async (next) => {
    if (next === undefined) {
      return;
    }

    await reset(next);
    customValueInput.value?.$el.focus();
  },
);

const submit = () => {
  if (!canSubmit.value) {
    return;
  }
  store.submit(submitValue());
};
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="Advanced Scan"
    :style="{ width: '500px', maxWidth: '92vw' }"
  >
    <div class="flex flex-col gap-3">
      <SelectButton
        v-model="attackType"
        :options="attackTypeOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        size="small"
        :pt="{
          root: {
            class:
              'flex w-full gap-1 p-1 rounded-md border border-surface-700 bg-surface-900 [&>*]:flex-1 [&>*]:justify-center',
          },
        }"
      >
        <template #option="{ option }">
          <i :class="option.icon" class="text-xs" />
          <span>{{ option.label }}</span>
        </template>
      </SelectButton>

      <div class="flex flex-col gap-1">
        <div class="grid grid-cols-[1fr_140px] gap-2.5">
          <label
            class="flex flex-col gap-1 text-xs font-medium text-surface-200"
          >
            Custom value
            <InputText
              ref="customValueInput"
              v-model="customValue"
              placeholder="Random if empty"
              class="w-full text-sm"
              autocomplete="off"
              @keyup.enter="submit"
            />
          </label>
          <label
            class="flex flex-col gap-1 text-xs font-medium text-surface-200"
          >
            Params / request
            <InputNumber
              v-model="maxParametersAmount"
              :min="1"
              fluid
              input-class="text-sm"
              placeholder="Auto"
            />
          </label>
        </div>
        <p class="text-[11px] text-surface-500">
          A random suffix keeps every value unique. Leave params empty to
          auto-detect.
        </p>
      </div>

      <div
        v-if="attackType === 'body' && bodyState.kind === 'valid'"
        class="flex flex-col gap-1.5"
      >
        <label class="text-xs font-medium text-surface-200">
          JSON body path
        </label>
        <div class="relative">
          <InputText
            v-model="jsonBodyPath"
            class="w-full text-sm pr-9"
            placeholder="e.g. $.data.user"
            autocomplete="off"
            @keyup.enter="submit"
          />
          <button
            v-tooltip.left="'Pick a path from the JSON body'"
            type="button"
            class="absolute right-0 top-0 bottom-0 w-9 flex items-center justify-center text-surface-400 hover:text-surface-100 hover:bg-surface-700/40 border-l border-surface-700/60 rounded-r-md transition-colors"
            :class="{ 'text-secondary-400': treeOpen }"
            @click="treeOpen = !treeOpen"
          >
            <i class="fas fa-folder-tree text-xs" />
          </button>
        </div>

        <p v-if="jsonPathError" class="text-xs text-danger-300">
          {{ jsonPathError }}
        </p>

        <div
          v-if="treeOpen"
          class="border border-surface-700/60 rounded-md bg-surface-900/40 overflow-hidden"
        >
          <div
            class="flex items-center justify-between px-2.5 py-1.5 border-b border-surface-700/60 bg-surface-800/40"
          >
            <span
              class="text-[11px] font-semibold uppercase tracking-wide text-surface-400"
            >
              Select JSON path
            </span>
            <button
              type="button"
              class="w-5 h-5 flex items-center justify-center rounded text-surface-400 hover:text-surface-100 hover:bg-surface-700/50"
              @click="treeOpen = false"
            >
              <i class="fas fa-xmark text-xs" />
            </button>
          </div>
          <div
            class="font-mono text-[11px] leading-relaxed p-2 overflow-y-auto max-h-[240px]"
          >
            <JsonPathTree
              name="$"
              :value="bodyState.value"
              path="$"
              :is-array-item="false"
              :level="0"
              @select="selectTreePath"
            />
          </div>
        </div>
      </div>

      <label
        v-if="attackType === 'headers'"
        class="flex items-center gap-2 cursor-pointer"
      >
        <Checkbox v-model="cacheBusterParameter" binary />
        <span class="text-xs text-surface-200">Add cache-buster parameter</span>
      </label>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <Button
          label="Cancel"
          severity="secondary"
          outlined
          size="small"
          @click="store.cancel()"
        />
        <Button
          label="Run scan"
          icon="fas fa-play"
          size="small"
          :disabled="!canSubmit"
          @click="submit"
        />
      </div>
    </template>
  </Dialog>
</template>
