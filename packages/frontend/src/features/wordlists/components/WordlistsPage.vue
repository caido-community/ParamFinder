<script setup lang="ts">
import Card from "primevue/card";
import { ref } from "vue";

import CreateWordlistDialog from "./CreateWordlistDialog.vue";
import PresetWordlists from "./PresetWordlists.vue";
import WordlistsTable from "./WordlistsTable.vue";

import PageHeader from "@/shared/components/PageHeader.vue";

const createDialogVisible = ref(false);
</script>

<template>
  <div class="h-full flex flex-col gap-1 min-h-0">
    <PageHeader
      title="Wordlists"
      description="Manage parameter wordlists and assign attack types. Duplicates across enabled wordlists are removed at scan time."
    />

    <div class="flex-1 min-h-0 flex flex-col gap-1">
      <Card
        class="flex-1 min-h-0 h-full"
        :pt="{
          root: { style: 'display: flex; flex-direction: column;' },
          body: { class: 'flex-1 p-0 flex flex-col min-h-0' },
          content: { class: 'flex-1 min-h-0 flex flex-col' },
        }"
      >
        <template #content>
          <WordlistsTable @create="createDialogVisible = true" />
        </template>
      </Card>

      <Card
        class="shrink-0"
        :pt="{
          body: { class: 'p-0' },
          content: { class: 'p-0' },
        }"
      >
        <template #content>
          <PresetWordlists />
        </template>
      </Card>
    </div>

    <CreateWordlistDialog
      v-model:visible="createDialogVisible"
      @created="createDialogVisible = false"
    />
  </div>
</template>
