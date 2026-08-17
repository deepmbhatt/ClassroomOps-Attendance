import { expect, test } from '@playwright/test'

test('admin dashboard is responsive and available', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Classroom operations/i })).toBeVisible()
  await expect(page.getByText(/Biometrics/i).first()).toBeVisible()
})

test('student face route has consent gate', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Student' }).click()
  await page.getByRole('link', { name: /Face Registration/i }).click()
  await expect(page.getByRole('heading', { name: /Guided face registration/i })).toBeVisible()
  await expect(page.getByText(/Consent required/i)).toBeVisible()
})
