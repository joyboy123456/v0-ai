"use client";

import { cn } from "@/lib/utils";

interface OptionSelectorProps<T extends string | number> {
  label: string;
  required?: boolean;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  columns?: "auto" | "equal";
  className?: string;
}

export function OptionSelector<T extends string | number>({
  label,
  required,
  options,
  value,
  onChange,
  columns = "auto",
  className,
}: OptionSelectorProps<T>) {
  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="flex items-center gap-1.5">
        <span className="text-[14px] font-medium text-foreground tracking-wide">
          {label}
        </span>
        {required && <span className="text-primary/70 text-xs mt-0.5">*</span>}
      </div>

      <div
        className={cn(
          "flex flex-wrap gap-2",
          columns === "equal" && "grid grid-cols-2",
        )}
      >
        {options.map((option) => (
          <button
            key={String(option.id)}
            onClick={() => onChange(option.id)}
            className={cn(
              "px-3.5 py-1.5 text-[12px] font-medium rounded-md border transition-colors",
              columns === "equal" && "w-full",
              value === option.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-transparent text-muted-foreground hover:border-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface RatioSelectorProps<T extends string> {
  label: string;
  required?: boolean;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export function RatioSelector<T extends string>({
  label,
  required,
  options,
  value,
  onChange,
}: RatioSelectorProps<T>) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[14px] font-medium text-foreground tracking-wide">
          {label}
        </span>
        {required && <span className="text-primary/70 text-xs mt-0.5">*</span>}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {options.map((option) => {
          const size = getRatioSize(option.id);

          return (
            <button
              key={option.id}
              onClick={() => onChange(option.id)}
              className={cn(
                "h-[64px] rounded-md border flex flex-col items-center justify-center gap-1.5 transition-colors",
                value === option.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:border-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "border-[1.5px] rounded-[3px] transition-colors",
                  value === option.id
                    ? "border-primary"
                    : "border-muted-foreground",
                )}
                style={size}
              />
              <span className="text-[11px] font-medium">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getRatioSize(id: string) {
  if (id === "3:4") return { width: 20, height: 28 };
  if (id === "4:3") return { width: 28, height: 20 };
  if (id === "2:3") return { width: 19, height: 28 };
  if (id === "3:2") return { width: 28, height: 19 };
  if (id === "9:16") return { width: 16, height: 28 };
  if (id === "16:9") return { width: 28, height: 16 };
  return { width: 24, height: 24 };
}
