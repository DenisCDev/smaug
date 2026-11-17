/** Cents as Brazilian currency text: formatCents(123456) → 'R$ 1.234,56'. */
export function formatCents(cents, currency = 'R$') {
  const sign = cents < 0 ? '-' : '';
  const value = Math.abs(cents);
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${currency} ${grouped},${fraction}`;
}
