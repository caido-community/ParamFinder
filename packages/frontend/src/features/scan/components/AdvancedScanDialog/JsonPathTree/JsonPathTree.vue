<script setup lang="ts">
import {
  appendJsonBodyPath,
  isInjectableJsonBodyPath,
} from "@paramfinder/engine";
import { computed, ref } from "vue";

defineOptions({ name: "JsonPathTree" });

const { name, value, path, isArrayItem, level } = defineProps<{
  name: string;
  value: unknown;
  path: string;
  isArrayItem: boolean;
  level: number;
}>();

const emit = defineEmits<{
  (event: "select", path: string): void;
}>();

const expanded = ref(level === 0);

const isExpandable = computed(
  () => typeof value === "object" && value !== null,
);

const isArray = computed(() => Array.isArray(value));
const isSelectable = computed(() => isInjectableJsonBodyPath(value, "$"));

const childEntries = computed(() => {
  if (!isExpandable.value) {
    return [];
  }
  const obj = value as Record<string, unknown> | unknown[];
  if (Array.isArray(obj)) {
    return obj.map((item, index) => ({
      key: String(index),
      value: item,
      path: appendJsonBodyPath(path, index),
      isArrayItem: true,
    }));
  }
  return Object.keys(obj).map((key) => ({
    key,
    value: obj[key],
    path: appendJsonBodyPath(path, key),
    isArrayItem: false,
  }));
});

const valueDisplay = computed(() => {
  if (typeof value === "string") {
    return { text: `"${value}"`, color: "text-orange-300" };
  }
  if (typeof value === "number") {
    return { text: String(value), color: "text-emerald-300" };
  }
  if (typeof value === "boolean") {
    return { text: String(value), color: "text-sky-400" };
  }
  if (value === null) {
    return { text: "null", color: "text-sky-400 italic opacity-80" };
  }
  return { text: "", color: "" };
});

const toggleExpanded = () => {
  expanded.value = !expanded.value;
};

const handleSelect = () => {
  if (isSelectable.value) {
    emit("select", path);
  }
};
</script>

<template>
  <div class="w-full">
    <div
      class="group flex items-center min-h-[20px] px-1 rounded-sm relative"
      :class="
        isSelectable
          ? 'hover:bg-surface-700/40 cursor-pointer'
          : 'cursor-default'
      "
      :style="{ paddingLeft: `${level * 12 + 4}px` }"
      @click="handleSelect"
    >
      <span
        v-if="isExpandable"
        class="inline-flex items-center justify-center w-3 h-3 text-[9px] text-surface-400 hover:text-surface-100 shrink-0"
        @click.stop="toggleExpanded"
      >
        <i :class="expanded ? 'fas fa-caret-down' : 'fas fa-caret-right'" />
      </span>
      <span v-else class="inline-block w-3 shrink-0" />

      <span class="ml-1 text-sky-300 whitespace-nowrap">
        {{ name }}<span v-if="!isArrayItem">:</span>
      </span>

      <span
        v-if="isExpandable"
        class="ml-1 text-[10px] text-surface-500 opacity-70 whitespace-nowrap"
      >
        {{ isArray ? "[]" : "{}" }}
      </span>

      <span
        v-else
        class="ml-2 truncate max-w-[220px] opacity-90"
        :class="valueDisplay.color"
      >
        {{ valueDisplay.text }}
      </span>

      <span
        class="ml-auto pl-2 text-[10px] text-sky-400/80 bg-sky-500/10 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
      >
        {{ path }}
      </span>
    </div>

    <div v-if="isExpandable && expanded">
      <JsonPathTree
        v-for="child in childEntries"
        :key="child.path"
        :name="child.key"
        :value="child.value"
        :path="child.path"
        :is-array-item="child.isArrayItem"
        :level="level + 1"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>
