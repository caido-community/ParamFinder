<script setup lang="ts">
import { useRequestList } from "./useRequestList";

import VirtualSortTable from "@/shared/components/VirtualSortTable.vue";

defineOptions({ name: "RequestList" });

const { store, requests, columns, loading, onRowClick, sort, loadMore } =
  useRequestList();
</script>

<template>
  <VirtualSortTable
    :rows="requests"
    :columns="columns"
    key-field="requestId"
    :selected-key="store.selectedRequestId"
    empty-icon="fas fa-inbox"
    empty-message="No requests recorded yet."
    server-side
    :loading="loading"
    @row-click="onRowClick"
    @sort-change="sort"
    @load-more="loadMore"
  />
</template>
