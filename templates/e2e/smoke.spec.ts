import { expect, test } from '@playwright/test';

// Smoke: the app boots and renders. Replace/extend with the real critical
// flows listed in tests/app.context.md.
test('home page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});
