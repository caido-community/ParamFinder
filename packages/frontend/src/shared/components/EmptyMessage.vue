<script setup lang="ts">
const {
  fill = true,
  compact = false,
  icon = undefined,
} = defineProps<{
  fill?: boolean;
  compact?: boolean;
  icon?: string;
}>();
</script>

<template>
  <div
    :class="[
      'flex flex-col items-center justify-center gap-3 text-sm text-surface-400 text-center',
      compact ? 'py-6' : fill ? 'flex-1 min-h-0' : 'h-full',
    ]"
  >
    <i
      v-if="icon !== undefined"
      :class="[icon, compact ? 'text-2xl' : 'text-3xl', 'text-surface-500']"
    />
    <slot />
  </div>
</template>
