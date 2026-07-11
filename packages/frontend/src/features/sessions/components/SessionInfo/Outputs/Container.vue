<script setup lang="ts">
import { Logs } from "./Logs";
import { Results } from "./Results";

defineOptions({ name: "SessionOutputs" });
</script>

<template>
  <div class="flex flex-1 min-h-0 flex-col gap-3">
    <Results />
    <Logs />
  </div>
</template>
