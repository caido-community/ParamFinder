<script setup lang="ts">
import { watchDebounced } from "@vueuse/core";
import Card from "primevue/card";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import { computed } from "vue";

import HTTPEditor from "./HTTPEditor/HTTPEditor.vue";

import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import EmptyMessage from "@/shared/components/EmptyMessage.vue";

defineOptions({ name: "RequestDetails" });

const fullHeightCardPt = {
  root: { style: "display: flex; flex-direction: column; height: 100%;" },
  body: { class: "flex-1 p-0 flex flex-col min-h-0" },
  content: { class: "flex-1 flex flex-col overflow-hidden min-h-0" },
};

const LOAD_DEBOUNCE_MS = 150;
const store = useSessionsStore();
const selectedRequestId = computed(() => store.selectedRequestId);
const detailState = computed(() =>
  store.getRequestDetailState(selectedRequestId.value),
);
const requestResponse = computed(() => detailState.value?.response);
const errorMessage = computed(() => detailState.value?.error);

watchDebounced(
  selectedRequestId,
  (requestId) => {
    if (requestId !== undefined) {
      void store.loadRequestDetails(requestId);
    }
  },
  { debounce: LOAD_DEBOUNCE_MS, immediate: true },
);

const requestRaw = computed(() => requestResponse.value?.request.raw ?? "");
const responseRaw = computed(() => requestResponse.value?.response.raw ?? "");
const host = computed(() => requestResponse.value?.request.host);
const port = computed(() => requestResponse.value?.request.port);
const isTls = computed(() => requestResponse.value?.request.tls);

const editorPanelPt = {
  root: {
    class: "min-w-0 min-h-0 overflow-hidden flex flex-col",
    style: "flex-grow: 1;",
  },
};

const overlayState = computed(
  (): { icon: string; message: string } | undefined => {
    if (selectedRequestId.value === undefined) {
      return {
        icon: "fas fa-hand-pointer",
        message: "Select a request to view its details.",
      };
    }
    if (errorMessage.value !== undefined) {
      return {
        icon: "fas fa-triangle-exclamation",
        message: errorMessage.value,
      };
    }
    return undefined;
  },
);
</script>

<template>
  <div class="flex flex-1 flex-col min-h-0 relative">
    <EmptyMessage
      v-if="overlayState !== undefined"
      :fill="false"
      :icon="overlayState.icon"
    >
      {{ overlayState.message }}
    </EmptyMessage>
    <Splitter
      v-show="overlayState === undefined"
      class="h-full min-h-0 bg-surface-900"
      :pt="{ root: { class: 'min-h-0 overflow-hidden border-0' } }"
    >
      <SplitterPanel :size="50" :min-size="20" :pt="editorPanelPt">
        <Card class="h-full" :pt="fullHeightCardPt">
          <template #content>
            <HTTPEditor
              type="request"
              :raw="requestRaw"
              :host="host"
              :port="port"
              :is-tls="isTls"
            />
          </template>
        </Card>
      </SplitterPanel>
      <SplitterPanel :size="50" :min-size="20" :pt="editorPanelPt">
        <Card class="h-full" :pt="fullHeightCardPt">
          <template #content>
            <HTTPEditor type="response" :raw="responseRaw" />
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
