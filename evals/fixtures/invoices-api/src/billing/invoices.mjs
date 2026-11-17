import { db } from '../db.mjs';

/** One invoice by id, or null. */
export async function getInvoice(id) {
  const [invoice] = await db.invoices.findMany({ where: { id }, take: 1 });
  return invoice ?? null;
}
