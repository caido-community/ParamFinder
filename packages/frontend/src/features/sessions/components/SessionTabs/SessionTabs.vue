<script setup lang="ts">
import Card from "primevue/card";
import ContextMenu from "primevue/contextmenu";

import SessionErrorPopover from "../SessionErrorPopover.vue";

import { useSessionTabs } from "./useSessionTabs";

defineOptions({ name: "SessionTabs" });

const plainCardPt = {
  body: { class: "p-0" },
  content: { class: "p-0" },
};

const {
  activeSessionId,
  sessions,
  contextMenu,
  menuItems,
  draggedSessionId,
  dropTarget,
  select,
  remove,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  statusLabel,
  statusTitle,
  statusDotClasses,
} = useSessionTabs();
</script>

<template>
  <Card v-if="sessions.length > 0" class="shrink-0" :pt="plainCardPt">
    <template #content>
      <div
        class="flex items-center gap-2 p-2 flex-wrap"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <div
          v-for="session in sessions"
          :key="session.ref.sessionId"
          :data-session-tab-id="session.ref.sessionId"
          draggable="true"
          class="group flex items-center gap-3 cursor-grab select-none px-3 py-1.5 rounded text-sm transition-all border bg-surface-900 active:cursor-grabbing"
          :class="[
            activeSessionId === session.ref.sessionId
              ? 'border-secondary-400 text-surface-0'
              : 'border-surface-700 text-surface-200 hover:border-surface-600',
            draggedSessionId === session.ref.sessionId ? 'opacity-30' : '',
            dropTarget?.sessionId === session.ref.sessionId &&
            dropTarget.kind === 'before'
              ? '!border-l-2 !border-l-secondary-400'
              : '',
            dropTarget?.sessionId === session.ref.sessionId &&
            dropTarget.kind === 'after'
              ? '!border-r-2 !border-r-secondary-400'
              : '',
          ]"
          :aria-grabbed="draggedSessionId === session.ref.sessionId"
          @click="select(session.ref.sessionId)"
          @contextmenu="onContextMenu($event, session.ref.sessionId)"
          @dragstart="onDragStart($event, session.ref.sessionId)"
          @dragend="onDragEnd"
        >
          <SessionErrorPopover
            v-if="session.error !== undefined"
            :title="statusLabel(session)"
            :message="session.error.message"
          >
            <span
              class="w-1.5 h-1.5 rounded-full shrink-0"
              :class="statusDotClasses(session)"
            />
          </SessionErrorPopover>
          <span
            v-else
            v-tooltip.top="statusTitle(session)"
            class="w-1.5 h-1.5 rounded-full shrink-0"
            :class="statusDotClasses(session)"
            :aria-label="statusTitle(session)"
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
