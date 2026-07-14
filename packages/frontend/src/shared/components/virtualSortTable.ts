export type VirtualSortColumn<Row extends object> = {
  field: Extract<keyof Row, string>;
  label: string;
  width: string;
  cellClass?: string;
  format?: (row: Row) => string;
};
