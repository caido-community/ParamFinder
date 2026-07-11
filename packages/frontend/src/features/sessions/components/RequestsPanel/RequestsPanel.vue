<script setup lang="ts">
import Card from "primevue/card";
import SelectButton from "primevue/selectbutton";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import { computed } from "vue";

import FindingsList from "./FindingsList/FindingsList.vue";
import RequestDetails from "./RequestDetails/RequestDetails.vue";
import RequestList from "./RequestList/RequestList.vue";

import {
  type SessionRequestsTab,
  useSessionsStore,
} from "@/features/sessions/stores/sessions.store";

defineOptions({ name: "RequestsPanel" });

const store = useSessionsStore();
const tab = computed({
  get: () => store.requestsTab,
  set: (value: SessionRequestsTab) => store.setRequestsTab(value),
});
const tabs: { label: string; value: SessionRequestsTab }[] = [
  { label: "Requests", value: "requests" },
  { label: "Findings", value: "findings" },
];

const fullHeightCardPt = {
  root: { style: "display: flex; flex-direction: column; height: 100%;" },
  body: { class: "flex-1 p-0 flex flex-col min-h-0" },
  content: { class: "flex-1 flex flex-col overflow-hidden min-h-0" },
};
</script>

<template>
  <Splitter
    layout="vertical"
    class="h-full min-h-0 requests-splitter"
    :pt="{ root: { class: 'overflow-hidden border-0 bg-transparent' } }"
  >
    <SplitterPanel
      :size="50"
      :min-size="20"
      :pt="{
        root: {
          class: 'min-h-0 overflow-hidden flex flex-col',
          style: 'flex-grow: 1;',
        },
      }"
    >
      <Card class="h-full" :pt="fullHeightCardPt">
        <template #content>
          <div class="p-1.5 flex items-center shrink-0">
            <SelectButton
              v-model="tab"
              :options="tabs"
              option-label="label"
              option-value="value"
              :allow-empty="false"
            />
          </div>

          <div class="flex flex-1 flex-col min-h-0 overflow-hidden">
            <RequestList v-if="tab === 'requests'" />
            <FindingsList v-else />
          </div>
        </template>
      </Card>
    </SplitterPanel>
    <SplitterPanel
      :size="50"
      :min-size="20"
      :pt="{
        root: {
          class: 'min-h-0 overflow-hidden flex flex-col',
          style: 'flex-grow: 1;',
        },
      }"
    >
      <Card class="h-full" :pt="fullHeightCardPt">
        <template #content>
          <RequestDetails />
        </template>
      </Card>
    </SplitterPanel>
  </Splitter>
</template>

<style scoped>
:deep(.p-splitter-gutter) {
  background: var(--p-surface-900);
}

:deep(.p-splitter-gutter-handle) {
  background: var(--p-surface-600);
}
</style>
