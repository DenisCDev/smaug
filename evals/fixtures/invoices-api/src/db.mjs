// In-memory stand-in for the database client, with a Prisma-like surface:
// findMany({ where, take }), where a field matches a value or { in: [...] }.
const tables = { invoices: [], items: [] };

export const stats = { queries: 0 };

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, value]) =>
    value && typeof value === 'object' && Array.isArray(value.in) ? value.in.includes(row[key]) : row[key] === value);

const table = (name) => ({
  async findMany({ where, take } = {}) {
    stats.queries += 1;
    const rows = tables[name].filter((row) => matches(row, where)).map((row) => ({ ...row }));
    return take === undefined ? rows : rows.slice(0, take);
  },
});

export const db = { invoices: table('invoices'), items: table('items') };

export function seed(data) {
  tables.invoices = data.invoices ?? [];
  tables.items = data.items ?? [];
  stats.queries = 0;
}
