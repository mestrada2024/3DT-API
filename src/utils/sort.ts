export type SortDirection = "asc" | "desc";

/**
 * Valida sortBy/sortDir de querystring contra una lista blanca de
 * columnas permitidas por endpoint (evita pasar un nombre de columna
 * arbitrario directo a Prisma orderBy). Si sortBy no está en la
 * lista, cae al default sin error — así un valor viejo/inválido en la
 * URL no rompe el listado, simplemente no ordena.
 */
export function parseSort<T extends string>(
  sortBy: string | undefined,
  sortDir: string | undefined,
  allowedFields: readonly T[],
  defaultField: T
): { field: T; direction: SortDirection } {

  const field =
    sortBy && (allowedFields as readonly string[]).includes(sortBy)
      ? (sortBy as T)
      : defaultField;

  const direction: SortDirection = sortDir === "desc" ? "desc" : "asc";

  return { field, direction };
}
