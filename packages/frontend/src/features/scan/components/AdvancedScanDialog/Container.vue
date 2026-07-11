<script setup lang="ts">
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import SelectButton from "primevue/selectbutton";
import { computed, nextTick, ref, watch } from "vue";

import { JsonPathTree } from "./JsonPathTree";
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
  canPickPath,
  jsonPathError,
  canSubmit,
  reset,
  submitValue,
  toggleTree,
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
  (next) => {
    if (next === undefined) {
      return;
    }

    reset(next);
    void nextTick(() => {
      customValueInput.value?.$el.focus();
    });
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
    :style="{ width: '480px', maxWidth: '92vw' }"
  >
    <div class="flex flex-col gap-4">
      <SelectButton
        v-model="attackType"
        :options="attackTypeOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        :pt="{
          root: { class: 'flex w-full [&>*]:flex-1 [&>*]:justify-center' },
        }"
      >
        <template #option="{ option }">
          <i :class="option.icon" class="text-xs" />
          <span>{{ option.label }}</span>
        </template>
      </SelectButton>

      <div class="flex flex-col gap-1.5">
        <label
          class="flex items-center gap-1.5 text-xs font-medium text-surface-200"
        >
          Custom parameter value
          <i
            v-tooltip.top="
              'A random value is appended to the end so each parameter is unique.'
            "
            class="fas fa-circle-question text-[11px] text-surface-500 cursor-help"
          />
        </label>
        <InputText
          ref="customValueInput"
          v-model="customValue"
          placeholder="Optional custom value"
          class="w-full text-sm"
          autocomplete="off"
          @keyup.enter="submit"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label
          class="flex items-center gap-1.5 text-xs font-medium text-surface-200"
        >
          Max parameters per request
          <i
            v-tooltip.top="
              'Maximum number of parameters tested per request. Leave empty to auto-detect.'
            "
            class="fas fa-circle-question text-[11px] text-surface-500 cursor-help"
          />
        </label>
        <InputNumber
          v-model="maxParametersAmount"
          :min="1"
          fluid
          placeholder="Auto-detect"
        />
      </div>

      <div v-if="attackType === 'body'" class="flex flex-col gap-1.5">
        <label
          class="flex items-center gap-1.5 text-xs font-medium text-surface-200"
        >
          JSON body path
          <i
            v-tooltip.top="
              'JSONPath into the request body, e.g. $.data.user. Use the picker to select a path.'
            "
            class="fas fa-circle-question text-[11px] text-surface-500 cursor-help"
          />
        </label>
        <div class="relative">
          <InputText
            v-model="jsonBodyPath"
            class="w-full font-mono text-sm pr-9"
            placeholder="e.g. $.data.user"
            autocomplete="off"
            @keyup.enter="submit"
          />
          <button
            v-tooltip.left="
              canPickPath
                ? 'Pick a path from the JSON body'
                : 'Path picker disabled — request has no JSON body'
            "
            type="button"
            class="absolute right-0 top-0 bottom-0 w-9 flex items-center justify-center text-surface-400 hover:text-surface-100 hover:bg-surface-700/40 disabled:opacity-40 disabled:cursor-not-allowed border-l border-surface-700/60 rounded-r-md transition-colors"
            :class="{ 'text-secondary-400': treeOpen }"
            :disabled="!canPickPath"
            @click="toggleTree"
          >
            <i class="fas fa-folder-tree text-xs" />
          </button>
        </div>

        <p v-if="jsonPathError" class="text-xs text-danger-300">
          {{ jsonPathError }}
        </p>

        <p
          v-if="bodyState.kind === 'empty'"
          class="flex items-start gap-2 text-xs text-sky-300/90 bg-sky-500/10 border-l-2 border-sky-500 px-2 py-1.5 rounded-sm"
        >
          <i class="fas fa-circle-info mt-0.5 shrink-0" />
          <span>
            This request has no body. The body attack sends a generated JSON
            body. Leave the path empty to inject at the root.
          </span>
        </p>
        <p
          v-else-if="bodyState.kind === 'not-json'"
          class="flex items-start gap-2 text-xs text-amber-300/90 bg-amber-500/10 border-l-2 border-amber-500 px-2 py-1.5 rounded-sm"
        >
          <i class="fas fa-triangle-exclamation mt-0.5 shrink-0" />
          <span>
            Request body is not valid JSON, so the picker is unavailable. ({{
              bodyState.reason
            }})
          </span>
        </p>

        <div
          v-if="treeOpen && bodyState.kind === 'valid'"
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
        <i
          v-tooltip.top="'Adds a random parameter to bypass response caches.'"
          class="fas fa-circle-question text-[11px] text-surface-500 cursor-help"
        />
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
