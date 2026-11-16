import type { ServiceCategory } from "../types/service-marketplace-types";

/**
 * Helpers for the self-referencing `service_categories` tree. The catalogue
 * is not fixed at two levels — a category may sit between a root and the
 * selectable leaf services, so all helpers handle arbitrary depth.
 */

/** Deepest selectable nodes — categories that have no children. */
export function isLeafCategory(
  category: ServiceCategory,
  categories: ServiceCategory[],
): boolean {
  return !categories.some((item) => item.parentId === category.id);
}

/** Direct children of a category (or roots when `parentId` is null), sorted. */
export function childrenOf(
  parentId: string | null,
  categories: ServiceCategory[],
): ServiceCategory[] {
  return categories
    .filter((item) =>
      parentId == null ? item.parentId == null : item.parentId === parentId,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Walk the parent chain up to the root category. */
export function rootCategory(
  category: ServiceCategory,
  categories: ServiceCategory[],
): ServiceCategory {
  let current = category;
  let guard = 0;
  while (current.parentId && guard++ < 10) {
    const parent = categories.find((item) => item.id === current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

/** All leaf services under a category, at any depth, in sort order. */
export function leafDescendants(
  parent: ServiceCategory,
  categories: ServiceCategory[],
): ServiceCategory[] {
  const leaves: ServiceCategory[] = [];
  for (const child of childrenOf(parent.id, categories)) {
    if (isLeafCategory(child, categories)) leaves.push(child);
    else leaves.push(...leafDescendants(child, categories));
  }
  return leaves;
}
