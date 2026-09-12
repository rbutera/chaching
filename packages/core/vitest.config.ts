import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', env: { CHACHING_PRICING_REFRESH: '0' }, include: ['src/**/*.{test,spec}.{js,ts,tsx}', 'scripts/**/*.{test,spec}.{js,ts,tsx}'], passWithNoTests: true } });
