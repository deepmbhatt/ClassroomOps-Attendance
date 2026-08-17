import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './src/tests/e2e',
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
  },
  use: { baseURL: 'http://127.0.0.1:4174' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
})
