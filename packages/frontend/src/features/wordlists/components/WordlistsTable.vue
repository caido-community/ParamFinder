<script setup lang="ts">
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import SelectButton from "primevue/selectbutton";
import type { AttackType, Wordlist } from "shared";
import { computed } from "vue";

import { useWordlistsStore } from "../stores/store";

import EmptyMessage from "@/shared/components/EmptyMessage.vue";
import { useActionResult } from "@/shared/composables/useActionResult";
import { useConfirm } from "@/shared/composables/useConfirm";
import { attackTypeSelectOptions } from "@/shared/constants/attackTypes";

const emit = defineEmits<{
  (event: "create"): void;
}>();

const wordlistsStore = useWordlistsStore();
const { showResult } = useActionResult();
const confirm = useConfirm();

const wordlists = computed(() => wordlistsStore.data);
const anyMutationPending = computed(
  () => wordlistsStore.mutation !== undefined,
);

const isRowBusy = (id: string) => {
  const mutation = wordlistsStore.mutation;
  if (mutation === undefined) {
    return false;
  }
  if (mutation.type === "clear") {
    return true;
  }
  if (
    mutation.type === "toggle" ||
    mutation.type === "remove" ||
    mutation.type === "attackTypes"
  ) {
    return mutation.id === id;
  }
  return false;
};

const toggleEnabled = async (wordlist: Wordlist) => {
  showResult(await wordlistsStore.toggle(wordlist), {
    errorPrefix: "Failed to update wordlist",
  });
};

const onAttackTypesChange = async (wordlist: Wordlist, next: AttackType[]) => {
  showResult(await wordlistsStore.updateAttackTypes(wordlist, next), {
    errorPrefix: "Failed to update attack types",
  });
};

const remove = (wordlist: Wordlist) => {
  confirm.require({
    header: "Remove wordlist",
    message: `Remove wordlist "${wordlist.name}"?`,
    acceptLabel: "Remove",
    accept: async () => {
      showResult(await wordlistsStore.remove(wordlist.id), {
        errorPrefix: "Failed to remove wordlist",
      });
    },
  });
};

const clearAll = () => {
  confirm.require({
    header: "Clear wordlists",
    message: "Remove all imported wordlists?",
    acceptLabel: "Clear all",
    accept: async () => {
      showResult(await wordlistsStore.clear(), {
        errorPrefix: "Failed to clear wordlists",
      });
    },
  });
};
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <div
      class="p-4 pb-3 shrink-0 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="space-y-0.5">
        <h3 class="text-md font-semibold">Active Wordlists</h3>
        <p class="text-sm text-surface-400">
          Toggle wordlists and choose which attack types they apply to.
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0 self-start sm:self-auto">
        <Button
          label="Create"
          icon="fas fa-plus"
          size="small"
          severity="secondary"
          outlined
          @click="emit('create')"
        />
        <Button
          label="Clear All"
          icon="fas fa-trash"
          size="small"
          severity="secondary"
          outlined
          :disabled="wordlistsStore.data.length === 0 || anyMutationPending"
          @click="clearAll"
        />
      </div>
    </div>

    <DataTable
      :value="wordlists"
      striped-rows
      scrollable
      scroll-height="flex"
      data-key="id"
      class="flex-1 min-h-0"
      :loading="wordlistsStore.loading"
      :pt="{
        root: { class: 'flex-1 min-h-0 flex flex-col' },
        tableContainer: { class: 'flex-1 min-h-0' },
        emptyMessage: {
          class: 'text-center text-sm text-surface-400 py-6',
        },
      }"
    >
      <template #empty>
        <EmptyMessage compact icon="fas fa-list">
          No wordlists imported. Create a new one or import a preset below.
        </EmptyMessage>
      </template>
      <Column header="Enabled" style="width: 90px">
        <template #body="{ data }">
          <Checkbox
            :model-value="data.enabled"
            binary
            :disabled="isRowBusy(data.id) || data.status !== 'active'"
            @update:model-value="toggleEnabled(data)"
          />
        </template>
      </Column>
      <Column field="name" header="Name">
        <template #body="{ data }">
          <div class="flex flex-col">
            <span class="text-sm select-text">{{ data.name }}</span>
            <span v-if="data.error" class="text-xs text-danger-300">
              {{ data.error }}
            </span>
            <span
              v-else-if="data.status !== 'active'"
              class="text-xs text-surface-400"
            >
              {{ data.status }}
            </span>
          </div>
        </template>
      </Column>
      <Column header="Attack Types" style="width: 280px">
        <template #body="{ data }">
          <SelectButton
            :model-value="data.attackTypes"
            :options="attackTypeSelectOptions"
            option-label="label"
            option-value="value"
            multiple
            size="small"
            :disabled="isRowBusy(data.id) || data.status !== 'active'"
            @update:model-value="onAttackTypesChange(data, $event)"
          />
        </template>
      </Column>
      <Column header="Actions" style="width: 110px">
        <template #body="{ data }">
          <Button
            v-tooltip.left="'Remove wordlist'"
            icon="fas fa-trash"
            size="small"
            severity="secondary"
            text
            :loading="isRowBusy(data.id)"
            :disabled="isRowBusy(data.id)"
            @click="remove(data)"
          />
        </template>
      </Column>
    </DataTable>
  </div>
</template>
