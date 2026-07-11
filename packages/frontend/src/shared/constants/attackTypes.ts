import { AttackType } from "shared";

export type AttackTypeOption = {
  label: string;
  value: AttackType;
  icon: string;
};

export const attackTypeOptions: AttackTypeOption[] = [
  { label: "Query", value: AttackType.Query, icon: "fas fa-link" },
  { label: "Body", value: AttackType.Body, icon: "fas fa-code" },
  { label: "Headers", value: AttackType.Headers, icon: "fas fa-list" },
];

export const attackTypes = attackTypeOptions.map(({ value }) => value);

export const attackTypeSelectOptions = attackTypeOptions.map(
  ({ label, value }) => ({ label, value }),
);
