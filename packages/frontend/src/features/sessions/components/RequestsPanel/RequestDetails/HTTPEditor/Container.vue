<script setup lang="ts">
import ContextMenu from "primevue/contextmenu";
import { ref } from "vue";

import { type HttpEditorType, useHttpEditor } from "./useHttpEditor";

defineOptions({ name: "HTTPEditor" });

const {
  type,
  raw,
  host = undefined,
  port = undefined,
  isTls = undefined,
} = defineProps<{
  type: HttpEditorType;
  raw: string;
  host?: string;
  port?: number;
  isTls?: boolean;
}>();

const root = ref<HTMLElement>();
const { contextMenu, menuItems, onContextMenu } = useHttpEditor(root, {
  type,
  raw: () => raw,
  host: () => host,
  port: () => port,
  isTls: () => isTls,
});
</script>

<template>
  <div
    ref="root"
    class="flex-1 min-h-0 overflow-hidden"
    @contextmenu="onContextMenu"
  />
  <ContextMenu v-if="type === 'request'" ref="contextMenu" :model="menuItems" />
</template>
