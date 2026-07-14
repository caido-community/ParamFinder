<script setup lang="ts">
import type { SessionDescriptor } from "shared";
import { computed } from "vue";

import SessionErrorPopover from "../../SessionErrorPopover.vue";

import {
  getSessionCapabilities,
  getSessionStateMeta,
  statusToneClasses,
} from "@/features/sessions/lib/sessionStats";

defineOptions({ name: "SessionStatusBadge" });

const { session } = defineProps<{ session: SessionDescriptor }>();

const stateMeta = computed(() => getSessionStateMeta(session.state));
const isRunning = computed(() => getSessionCapabilities(session).isRunning);
const dotClass = computed(() => statusToneClasses[stateMeta.value.tone]);
const errorMessage = computed(() => session.error?.message);
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
