"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

type CheckboxState = boolean | "indeterminate";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "checked" | "defaultChecked" | "onChange" | "type"> {
  checked?: CheckboxState;
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { checked = false, className, disabled, onCheckedChange, ...props },
  forwardedRef
) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, []);

  React.useEffect(() => {
    if (!inputRef.current) {
      return;
    }
    inputRef.current.indeterminate = checked === "indeterminate";
  }, [checked]);

  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-[7px]",
        disabled ? "cursor-not-allowed opacity-60" : "",
        className
      )}
    >
      <input
        {...props}
        ref={inputRef}
        type="checkbox"
        checked={checked === true}
        disabled={disabled}
        className="peer sr-only"
        onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
      />
      <span
        className={cn(
          "flex size-4 items-center justify-center rounded-[7px] border border-border/80 bg-background text-primary transition",
          "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
          checked ? "border-primary/60 bg-primary/10" : "bg-background"
        )}
      >
        {checked === "indeterminate" ? <Minus className="size-3" /> : checked ? <Check className="size-3" /> : null}
      </span>
    </label>
  );
});
