<script setup lang="ts">
import Popover from "primevue/popover";
import { ref, useId } from "vue";

defineOptions({ name: "SessionErrorPopover", inheritAttrs: false });

const { title, message } = defineProps<{
  title: string;
  message: string;
}>();

const popover = ref<InstanceType<typeof Popover>>();
const visible = ref(false);
const popoverId = `session-error-${useId()}`;
let hovered = false;
let focused = false;

const show = (event: Event) => {
  visible.value = true;
  popover.value?.show(event);
};

const hide = () => {
  visible.value = false;
  popover.value?.hide();
};

const onMouseEnter = (event: MouseEvent) => {
  hovered = true;
  show(event);
};

const onMouseLeave = () => {
  hovered = false;
  if (!focused) hide();
};

const onFocus = (event: FocusEvent) => {
  focused = true;
  show(event);
};

const onBlur = () => {
  focused = false;
  if (!hovered) hide();
};
</script>

<template>
  <button
    v-bind="$attrs"
    type="button"
    class="inline-flex items-center gap-1.5 rounded-sm border-0 bg-transparent p-0 text-inherit cursor-help focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger-400"
    aria-haspopup="dialog"
    :aria-expanded="visible"
    :aria-controls="popoverId"
    :aria-label="`${title}: ${message}`"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @focus="onFocus"
    @blur="onBlur"
    @click="show"
    @keydown.esc.stop="hide"
  >
    <slot />
  </button>

  <Popover
    ref="popover"
    :pt="{ root: { id: popoverId } }"
    @show="visible = true"
    @hide="visible = false"
  >
    <div class="max-w-96 space-y-1 text-sm">
      <div class="font-medium text-danger-300">{{ title }}</div>
      <div class="whitespace-pre-wrap break-words text-surface-200">
        {{ message }}
      </div>
    </div>
  </Popover>
</template>
