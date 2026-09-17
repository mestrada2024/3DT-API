export type SortDirection = "asc" | "desc";

interface SortableHeaderProps {
  label: string;
  field: string;
  sortBy: string;
  sortDir: SortDirection;
  onSort: (field: string) => void;
}

export function SortableHeader({ label, field, sortBy, sortDir, onSort }: SortableHeaderProps) {
  const active = sortBy === field;

  return (
    <th
      className={active ? "sortable-th sortable-th-active" : "sortable-th"}
      onClick={() => onSort(field)}
    >
      {label}
      <span className="sort-arrow">
        {active ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
      </span>
    </th>
  );
}
