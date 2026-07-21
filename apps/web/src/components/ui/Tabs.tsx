import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export type TabOption<T extends string> = {
  value: T;
  label: string;
  content: ReactNode;
};

type TabsProps<T extends string> = {
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: TabOption<T>[];
};

export function Tabs<T extends string>({ label, value, onValueChange, options }: TabsProps<T>) {
  return (
    <RadixTabs.Root value={value} onValueChange={(next) => onValueChange(next as T)}>
      <RadixTabs.List className="segmented-control" aria-label={label}>
        {options.map((option) => (
          <RadixTabs.Trigger key={option.value} value={option.value}>{option.label}</RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {options.map((option) => (
        <RadixTabs.Content key={option.value} value={option.value} className="tab-panel" tabIndex={0}>
          {option.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
