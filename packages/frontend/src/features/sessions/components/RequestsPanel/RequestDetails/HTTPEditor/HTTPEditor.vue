<script setup lang="ts">
import ContextMenu from "primevue/contextmenu";
import { computed, ref } from "vue";

import { type HttpEditorSource, useHttpEditor } from "./useHttpEditor";

defineOptions({ name: "HTTPEditor" });

const { source: editorSource } = defineProps<{ source: HttpEditorSource }>();

const root = ref<HTMLElement>();
const source = computed(() => editorSource);
const { contextMenu, menuItems, onContextMenu } = useHttpEditor(root, source);
</script>

<template>
  <div
    ref="root"
    class="flex-1 min-h-0 overflow-hidden"
    @contextmenu="onContextMenu"
  />
  <ContextMenu
    v-if="editorSource.type === 'request'"
    ref="contextMenu"
    :model="menuItems"
  />
</template>
