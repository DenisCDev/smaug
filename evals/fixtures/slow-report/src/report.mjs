/** Monthly total per customer, sorted by customer id: [{ customerId, total }]. */
export function monthlyTotals(orders) {
  const customers = [...new Set(orders.map((order) => order.customerId))];
  return customers.sort().map((customerId) => ({
    customerId,
    total: orders.filter((order) => order.customerId === customerId).reduce((sum, order) => sum + order.amount, 0),
  }));
}
