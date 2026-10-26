import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DataTableProps {
  children: ReactNode;
  className?: string;
}

export function DataTable({ children, className }: DataTableProps) {
  return (
    <div className={cn("rounded-2xl border border-line bg-white overflow-hidden dark:bg-gray-800 dark:border-gray-700", className)}>
      <div className="overflow-x-auto">
        <table className="w-full">
          {children}
        </table>
      </div>
    </div>
  );
}

interface DataTableHeaderProps {
  children: ReactNode;
  className?: string;
}

export function DataTableHeader({ children, className }: DataTableHeaderProps) {
  return (
    <thead className={cn("border-b border-line bg-cream dark:bg-gray-900 dark:border-gray-700", className)}>
      {children}
    </thead>
  );
}

interface DataTableBodyProps {
  children: ReactNode;
  className?: string;
}

export function DataTableBody({ children, className }: DataTableBodyProps) {
  return (
    <tbody className={cn("divide-y divide-line dark:divide-gray-700", className)}>
      {children}
    </tbody>
  );
}

interface DataTableRowProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function DataTableRow({ children, className, onClick }: DataTableRowProps) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-cream dark:hover:bg-gray-700",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

interface DataTableHeadProps {
  children: ReactNode;
  className?: string;
}

export function DataTableHead({ children, className }: DataTableHeadProps) {
  return (
    <th className={cn("px-4 py-3 text-left text-[0.78rem] font-semibold uppercase tracking-wider text-ink-2 dark:text-gray-400", className)}>
      {children}
    </th>
  );
}

interface DataTableCellProps {
  children: ReactNode;
  className?: string;
}

export function DataTableCell({ children, className }: DataTableCellProps) {
  return (
    <td className={cn("px-4 py-3 text-[0.9rem] text-ink dark:text-gray-100", className)}>
      {children}
    </td>
  );
}

interface DataTableEmptyProps {
  message?: string;
  colSpan?: number;
}

export function DataTableEmpty({ message = "No data available", colSpan = 1 }: DataTableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-[0.9rem] text-ink-2 dark:text-gray-400">
        {message}
      </td>
    </tr>
  );
}
