import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.{test,spec}.{js,ts,tsx}'],
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            'tests/archive_*.test.ts',
            'tests/cost_calculator.test.ts',
            'tests/knowledge_workspace.test.ts',
            'tests/pairwise_evaluation_harness.test.ts',
            'tests/second_device_preflight.test.ts',
            'tests/strategic_opportunity_briefing.test.ts',
            'tests/temporal_reasoning.test.ts',
            'tests/turn_aware_segmentation.test.ts',
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['store.ts', 'utils/**/*.ts', 'services/**/*.ts'],
        },
    },
});
