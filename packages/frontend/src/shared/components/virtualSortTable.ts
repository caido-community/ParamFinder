export type VirtualSortRow = Record<string, string | number | undefined>;

export type VirtualSortColumn = {
  field: string;
  label: string;
  width: string;
  cellClass?: string;
  format?: (row: VirtualSortRow) => string;
  sortValue?: (row: VirtualSortRow) => string | number | undefined;
};
