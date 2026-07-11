<script setup lang="ts">
import { useResults } from "./useResults";

import EmptyMessage from "@/shared/components/EmptyMessage.vue";

defineOptions({ name: "SessionResults" });

const {
  store,
  findings,
  findingCount,
  canLoadMore,
  getFindingKey,
  copy,
  download,
  openFinding,
  loadMore,
} = useResults();
</script>

<template>
  <div class="flex flex-col gap-2 flex-1 min-h-0">
    <div class="flex items-center justify-between gap-3 shrink-0">
      <h4 class="text-sm font-medium text-surface-300 leading-snug">
        Results
        <span class="text-surface-500">({{ findingCount }})</span>
      </h4>
      <div class="flex items-center gap-3 shrink-0">
        <button
          type="button"
          class="text-sm text-surface-400 transition-colors hover:text-surface-100 disabled:opacity-40 disabled:pointer-events-none"
          :disabled="findingCount === 0"
          @click="copy"
        >
          Copy
        </button>
        <button
          type="button"
          class="text-sm text-surface-400 transition-colors hover:text-surface-100 disabled:opacity-40 disabled:pointer-events-none"
          :disabled="findingCount === 0"
          @click="download"
        >
          Download
        </button>
      </div>
    </div>
    <div
      class="flex flex-col flex-1 min-h-0 rounded-lg bg-surface-900 px-1 py-2 overflow-auto font-mono text-sm leading-relaxed text-surface-200 border border-surface-700 select-text"
    >
      <EmptyMessage v-if="findings.length === 0" icon="fas fa-search">
        No parameters discovered yet.
      </EmptyMessage>
      <div v-else class="flex flex-col gap-1">
        <button
          v-for="finding in findings"
          :key="getFindingKey(finding)"
          type="button"
          class="w-full rounded px-2 py-1 text-left transition-colors hover:bg-surface-800 focus-visible:outline focus-visible:outline-1 focus-visible:outline-secondary-400"
          :class="
            store.selectedFindingKey === getFindingKey(finding)
              ? 'bg-highlight text-surface-0'
              : 'text-surface-200'
          "
          @click="openFinding(finding)"
        >
          <span class="whitespace-pre-wrap break-words">
            {{ finding.parameter.name }}
          </span>
        </button>
      </div>
      <button
        v-if="canLoadMore"
        type="button"
        class="w-full rounded px-2 py-1 text-center text-xs text-secondary-300 hover:text-secondary-200"
        @click="loadMore"
      >
        Load more findings
      </button>
    </div>
  </div>
</template>
