"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const Tooltip = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & { content: React.ReactNode }
>(({ className, content, children, ...props }, ref) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      {...props}
    >
      {children}
      {open && (
        <div
          className={cn(
            "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs text-primary-foreground bg-primary rounded shadow-md whitespace-nowrap z-50",
            className
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
});
Tooltip.displayName = "Tooltip";

const TooltipTrigger = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ children, ...props }, ref) => <div ref={ref} {...props}>{children}</div>
);
TooltipTrigger.displayName = "TooltipTrigger";

export { Tooltip, TooltipTrigger, TooltipProvider };
