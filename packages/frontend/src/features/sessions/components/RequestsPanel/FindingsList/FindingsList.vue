<script setup lang="ts">
import { useFindingsList } from "./useFindingsList";

import VirtualSortTable from "@/shared/components/VirtualSortTable.vue";

defineOptions({ name: "FindingsList" });

const {
  selectedFindingKey,
  findings,
  columns,
  loading,
  onRowClick,
  sort,
  loadMore,
} = useFindingsList();
</script>

<template>
  <VirtualSortTable
    :rows="findings"
    :columns="columns"
    key-field="key"
    :selected-key="selectedFindingKey"
    empty-icon="fas fa-bug"
    empty-message="No findings yet."
    :loading="loading"
    @row-click="onRowClick"
    @sort-change="sort"
    @load-more="loadMore"
  />
</template>
