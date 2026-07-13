<script setup lang="ts">
import { computed } from "vue";

import SessionErrorPopover from "../../SessionErrorPopover.vue";

import {
  getSessionCapabilities,
  getSessionStateMeta,
  statusToneClasses,
} from "@/features/sessions/lib/sessionStats";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";

defineOptions({ name: "SessionStatusBadge" });

const store = useSessionsStore();

const session = computed(() => store.activeSession);
const stateMeta = computed(() => getSessionStateMeta(session.value?.state));
const isRunning = computed(
  () => getSessionCapabilities(session.value).isRunning,
);
const dotClass = computed(() => statusToneClasses[stateMeta.value.tone]);
const errorMessage = computed(() => session.value?.error?.message);
</script>

<template>
  <SessionErrorPopover
    v-if="errorMessage !== undefined"
    class="inline-flex items-center gap-1.5 text-sm leading-snug"
    :title="stateMeta.label"
    :message="errorMessage"
  >
    <span
      class="w-1.5 h-1.5 rounded-full shrink-0"
      :class="[dotClass, isRunning ? 'animate-pulse' : '']"
    />
    <span class="text-surface-200">{{ stateMeta.label }}</span>
  </SessionErrorPopover>

  <span
    v-else
    class="inline-flex items-center gap-1.5 text-sm leading-snug"
    :aria-label="stateMeta.label"
  >
    <span
      class="w-1.5 h-1.5 rounded-full shrink-0"
      :class="[dotClass, isRunning ? 'animate-pulse' : '']"
    />
    <span class="text-surface-200">{{ stateMeta.label }}</span>
  </span>
</template>
