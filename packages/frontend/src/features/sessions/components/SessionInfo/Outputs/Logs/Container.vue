<script setup lang="ts">
import { useLogs } from "./useLogs";

import EmptyMessage from "@/shared/components/EmptyMessage.vue";

defineOptions({ name: "SessionLogs" });

const { logs, logCount, canLoadMore, scrollRef, copy, loadMore } = useLogs();
</script>

<template>
  <div class="flex flex-col min-h-0 flex-1 gap-2">
    <div class="flex items-center justify-between gap-3 shrink-0">
      <h4 class="text-sm font-medium text-surface-300 leading-snug">
        Logs <span class="text-surface-500">({{ logCount }})</span>
      </h4>
      <button
        type="button"
        class="text-sm text-surface-400 transition-colors hover:text-surface-100 disabled:opacity-40 disabled:pointer-events-none shrink-0"
        :disabled="logCount === 0"
        @click="copy"
      >
        Copy
      </button>
    </div>
    <div
      ref="scrollRef"
      class="flex flex-col flex-1 min-h-0 rounded-lg bg-surface-900 px-3 py-2 overflow-auto font-mono text-sm leading-relaxed text-surface-200 border border-surface-700 select-text"
    >
      <EmptyMessage v-if="logs.length === 0" icon="fas fa-terminal">
        No logs yet.
      </EmptyMessage>
      <p
        v-for="(log, index) in logs"
        :key="index"
        class="whitespace-pre-wrap break-words"
      >
        {{ log }}
      </p>
      <button
        v-if="canLoadMore"
        type="button"
        class="py-2 text-xs text-secondary-300 hover:text-secondary-200"
        @click="loadMore"
      >
        Load more logs
      </button>
    </div>
  </div>
</template>
