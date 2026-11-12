import { cn } from "@/lib/utils";
import type { DisplayStatus } from "@/lib/paynudge/types";

const CLS: Record<DisplayStatus, string> = {
  paid: "stamp-paid",
  waiting: "stamp-waiting",
  late: "stamp-late",
  cancelled: "stamp-cancelled",
};

export function StatusStamp({
  status,
  days,
  size = "sm",
  className,
}: {
  status: DisplayStatus;
  days?: number;
  size?: "sm" | "xl";
  className?: string;
}) {
  const label = status === "late" && days ? `Late ${days}d` : status;
  return (
    <span
      className={cn("stamp", CLS[status], size === "xl" && "stamp-xl animate-stamp", className)}
    >
      {label}
    </span>
  );
}
