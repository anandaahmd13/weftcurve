import { test, expect } from '@playwright/test';

test('resets local data, launches, trades, distributes, and claims in the local simulator', async ({ page }) => {
  const suffix = `${Date.now()}`.slice(-6);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New tokens. Shared possibilities.' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose identity' }).click();
  await page.getByRole('button', { name: /Creator Launch tokens/ }).click();
  await expect(page.getByRole('button', { name: 'Demo creator' })).toBeVisible();

  await page.getByRole('button', { name: 'Simulator tools' }).click();
  await page.getByRole('button', { name: 'Reset simulator' }).click();
  await page.getByLabel('Type RESET LOCAL SIMULATOR to confirm').fill('RESET LOCAL SIMULATOR');
  await page.getByRole('button', { name: 'Delete local simulator data' }).click();
  await expect(page.getByRole('button', { name: 'Choose identity' })).toBeVisible();

  await page.getByRole('button', { name: 'Choose identity' }).click();
  await page.getByRole('button', { name: /Creator Launch tokens/ }).click();
  await page.getByRole('link', { name: 'Launch', exact: true }).click();
  await page.getByLabel(/Token name/).fill(`Browser ${suffix}`);
  await page.getByLabel(/Symbol/).fill(`F${suffix.slice(-5)}`);
  await page.getByLabel('Destination mode').selectOption('holders');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Review token' }).click();
  await page.getByRole('button', { name: 'Launch in simulator' }).click();
  await expect(page.getByRole('heading', { name: `Browser ${suffix}` })).toBeVisible();
  await page.getByRole('button', { name: 'Demo creator' }).click();
  await page.getByRole('button', { name: /Holder A Buy tokens/ }).click();
  await expect(page.getByRole('button', { name: 'Holder A', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '1 SOL', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review purchase' })).toBeEnabled();
  await page.getByRole('button', { name: 'Review purchase' }).click();
  await page.getByRole('button', { name: 'Confirm simulation' }).click();
  await page.getByRole('button', { name: 'Run simulation epoch' }).click();
  await page.getByRole('button', { name: 'Run epoch' }).click();
  await page.getByRole('link', { name: 'Rewards', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rewards by token' })).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(`Browser ${suffix}`) });
  await expect(row.getByRole('button', { name: 'Claim', exact: true })).toBeEnabled();
  await row.getByRole('button', { name: 'Claim', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Claim' }).click();
  await expect(page.getByRole('heading', { name: 'Claim history' })).toBeVisible();
});
