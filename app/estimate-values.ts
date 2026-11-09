type EstimateValue = { catalogPosition?: string; quantity: number; unitPrice: number; selected?: boolean };

// The supplied BoQ aggregates quantities by position and sums unrounded line
// values. Round only the displayed final amount, just like its subtotal cell.
export function estimateTotal(rows: EstimateValue[]) {
  const groups = new Map<string, { position: number; quantity: number; price: number }>();
  for (const row of rows) {
    if (row.selected === false || row.catalogPosition === "included") continue;
    const key = `${row.catalogPosition ?? ""}:${row.unitPrice}`;
    const group = groups.get(key) ?? { position: Number(row.catalogPosition) || 0, quantity: 0, price: row.unitPrice };
    group.quantity += row.quantity;
    groups.set(key, group);
  }
  const raw = [...groups.values()].sort((a, b) => a.position - b.position).reduce((sum, group) => sum + group.quantity * group.price, 0);
  return Math.round((raw + Number.EPSILON) * 100) / 100;
}
