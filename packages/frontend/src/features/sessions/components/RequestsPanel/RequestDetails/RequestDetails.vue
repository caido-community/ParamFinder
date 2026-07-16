<script setup lang="ts">
import { watchDebounced } from "@vueuse/core";
import { storeToRefs } from "pinia";
import Card from "primevue/card";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import { computed } from "vue";

import HTTPEditor from "./HTTPEditor/HTTPEditor.vue";

import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import { useSessionViewStore } from "@/features/sessions/stores/sessionView.store";
import EmptyMessage from "@/shared/components/EmptyMessage.vue";

defineOptions({ name: "RequestDetails" });

const fullHeightCardPt = {
  root: { style: "display: flex; flex-direction: column; height: 100%;" },
  body: { class: "flex-1 p-0 flex flex-col min-h-0" },
  content: { class: "flex-1 flex flex-col overflow-hidden min-h-0" },
};

const LOAD_DEBOUNCE_MS = 150;
const store = useSessionsStore();
const viewStore = useSessionViewStore();
const { selectedRequestId } = storeToRefs(viewStore);
watchDebounced(
  selectedRequestId,
  async (requestId) => {
    if (requestId !== undefined) {
      await store.loadRequestDetails(requestId);
    }
  },
  { debounce: LOAD_DEBOUNCE_MS, immediate: true },
);

const editorPanelPt = {
  root: {
    class: "min-w-0 min-h-0 overflow-hidden flex flex-col",
    style: "flex-grow: 1;",
  },
};

const detailView = computed(() => {
  if (selectedRequestId.value === undefined) {
    return {
      kind: "message" as const,
      icon: "fas fa-hand-pointer",
      message: "Select a request to view its details.",
    };
  }

  const detail = viewStore.requestDetail;
  if (detail.kind === "success") {
    return { kind: "response" as const, response: detail.response };
  }
  if (detail.kind === "error") {
    return {
      kind: "message" as const,
      icon: "fas fa-triangle-exclamation",
      message: detail.error,
    };
  }
  return {
    kind: "message" as const,
    icon: "fas fa-spinner fa-spin",
    message: "Loading request details…",
  };
});
</script>

<template>
  <div class="flex flex-1 flex-col min-h-0 relative">
    <EmptyMessage
      v-if="detailView.kind === 'message'"
      :fill="false"
      :icon="detailView.icon"
    >
      {{ detailView.message }}
    </EmptyMessage>
    <Splitter
      v-else
      class="h-full min-h-0 bg-surface-900"
      :pt="{ root: { class: 'min-h-0 overflow-hidden border-0' } }"
    >
      <SplitterPanel :size="50" :min-size="20" :pt="editorPanelPt">
        <Card class="h-full" :pt="fullHeightCardPt">
          <template #content>
            <HTTPEditor
              :source="{
                type: 'request',
                raw: detailView.response.request.raw,
                connectionInfo: {
                  host: detailView.response.request.host,
                  port: detailView.response.request.port,
                  isTls: detailView.response.request.tls,
                },
              }"
            />
          </template>
        </Card>
      </SplitterPanel>
      <SplitterPanel :size="50" :min-size="20" :pt="editorPanelPt">
        <Card class="h-full" :pt="fullHeightCardPt">
          <template #content>
            <HTTPEditor
              :source="{
                type: 'response',
                raw: detailView.response.response.raw ?? '',
              }"
            />
          </template>
        </Card>
      </SplitterPanel>
    </Splitter>
  </div>
</template>

<style scoped>
:deep(.p-splitter-gutter) {
  background: var(--p-surface-900);
}

:deep(.p-splitter-gutter-handle) {
  background: var(--p-surface-600);
}
</style>
