import type { AttackType } from "shared";

export type AttackTypeOption = {
  label: string;
  value: AttackType;
  icon: string;
};

export const attackTypes: AttackType[] = ["query", "body", "headers"];

export const attackTypeOptions: AttackTypeOption[] = [
  { label: "Query", value: "query", icon: "fas fa-link" },
  { label: "Body", value: "body", icon: "fas fa-code" },
  { label: "Headers", value: "headers", icon: "fas fa-list" },
];

export const attackTypeSelectOptions = attackTypeOptions.map(
  ({ label, value }) => ({ label, value }),
);
