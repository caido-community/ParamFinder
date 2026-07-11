<script setup lang="ts">
import Card from "primevue/card";
import ContextMenu from "primevue/contextmenu";

import { useSessionTabs } from "./useSessionTabs";

import { plainCardPt } from "@/shared/utils/cardPt";

defineOptions({ name: "SessionTabs" });

const {
  store,
  sessions,
  contextMenu,
  menuItems,
  select,
  remove,
  onContextMenu,
  statusLabel,
  statusDotClasses,
} = useSessionTabs();
</script>

<template>
  <Card v-if="sessions.length > 0" class="shrink-0" :pt="plainCardPt">
    <template #content>
      <div class="flex items-center gap-2 p-2 flex-wrap">
        <div
          v-for="session in sessions"
          :key="session.ref.sessionId"
          class="group flex items-center gap-3 cursor-pointer px-3 py-1.5 rounded text-sm transition-all border bg-surface-900"
          :class="
            store.activeSessionId === session.ref.sessionId
              ? 'border-secondary-400 text-surface-0'
              : 'border-surface-700 text-surface-200 hover:border-surface-600'
          "
          @click="select(session.ref.sessionId)"
          @contextmenu="onContextMenu($event, session.ref.sessionId)"
        >
          <span
            class="w-1.5 h-1.5 rounded-full shrink-0"
            :class="statusDotClasses(session)"
            :title="statusLabel(session)"
          />
          <span class="font-mono text-xs truncate max-w-[180px]">
            {{ session.ref.sessionId }}
          </span>
          <button
            class="shrink-0 text-surface-500 transition-colors hover:!text-danger-400"
            title="Remove session"
            @click="remove($event, session.ref.sessionId)"
          >
            <i class="fas fa-times text-xs" />
          </button>
        </div>
        <div class="flex-1" />
      </div>
    </template>
  </Card>
  <ContextMenu ref="contextMenu" :model="menuItems" />
</template>
