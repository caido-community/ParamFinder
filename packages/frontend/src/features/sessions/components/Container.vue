<script setup lang="ts">
import Card from "primevue/card";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import { computed } from "vue";

import { RequestsPanel } from "./RequestsPanel";
import { SessionInfo } from "./SessionInfo";
import { SessionTabs } from "./SessionTabs";

import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import EmptyMessage from "@/shared/components/EmptyMessage.vue";

defineOptions({ name: "Sessions" });

const sessionsStore = useSessionsStore();

const noProject = computed(() => sessionsStore.noProjectSelected);
const hasSessions = computed(() => sessionsStore.list.length > 0);
const hasActive = computed(() => sessionsStore.activeSession !== undefined);
</script>

<template>
  <div class="h-full flex flex-col gap-1 min-h-0">
    <SessionTabs />

    <Card
      v-if="noProject"
      class="flex-1 min-h-0"
      :pt="{
        root: { style: 'display: flex; flex-direction: column;' },
        body: { class: 'flex-1 p-0 flex flex-col min-h-0' },
        content: { class: 'flex-1 flex items-center justify-center' },
      }"
    >
      <template #content>
        <div class="flex flex-col items-center gap-3 text-center px-6 py-12">
          <i class="fas fa-folder-open text-4xl text-surface-500" />
          <div>
            <h2 class="text-lg font-semibold text-surface-100">
              No project selected
            </h2>
            <p class="text-sm text-surface-400 mt-1">
              Open or create a project in Caido to use ParamFinder.
            </p>
          </div>
        </div>
      </template>
    </Card>

    <Card
      v-else-if="!hasSessions"
      class="flex-1 min-h-0"
      :pt="{
        root: { style: 'display: flex; flex-direction: column;' },
        body: { class: 'flex-1 p-0 flex flex-col min-h-0' },
        content: { class: 'flex-1 flex items-center justify-center' },
      }"
    >
      <template #content>
        <div class="flex flex-col items-center gap-3 text-center px-6 py-12">
          <i class="fas fa-search text-4xl text-surface-500" />
          <div>
            <h2 class="text-lg font-semibold text-surface-100">
              No ParamFinder sessions yet
            </h2>
            <p class="text-sm text-surface-400 mt-1">
              Right-click any HTTP request and run a
              <span class="text-surface-200 font-medium">Param Finder</span>
              command, or open the command palette (Ctrl/Cmd+Shift+P).
            </p>
          </div>
        </div>
      </template>
    </Card>

    <Splitter
      v-else-if="hasActive"
      class="flex-1 min-h-0"
      :pt="{
        root: { class: 'min-h-0 overflow-hidden border-0 bg-transparent' },
      }"
    >
      <SplitterPanel
        :size="40"
        :min-size="20"
        :pt="{
          root: {
            class: 'min-h-0 overflow-hidden flex flex-col',
            style: 'flex-grow: 1;',
          },
        }"
      >
        <SessionInfo />
      </SplitterPanel>
      <SplitterPanel
        :size="60"
        :min-size="30"
        :pt="{
          root: {
            class: 'min-h-0 overflow-hidden flex flex-col',
            style: 'flex-grow: 1;',
          },
        }"
      >
        <RequestsPanel />
      </SplitterPanel>
    </Splitter>

    <Card
      v-else
      class="flex-1 min-h-0"
      :pt="{
        root: { style: 'display: flex; flex-direction: column;' },
        body: { class: 'flex-1 p-0 flex flex-col min-h-0' },
        content: { class: 'flex-1 flex items-center justify-center' },
      }"
    >
      <template #content>
        <EmptyMessage :fill="false" icon="fas fa-arrow-up">
          Select a session above to view its details.
        </EmptyMessage>
      </template>
    </Card>
  </div>
</template>
