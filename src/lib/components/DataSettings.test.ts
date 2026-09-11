// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import { Rollup } from '$lib/core/rollup/rollup';
import DataSettings from './DataSettings.svelte';

it('retains a failed cutover edit for retry and supports clearing it', async () => {
	const onSave = vi.fn<(value: number | null) => Promise<void>>()
		.mockRejectedValueOnce(new Error('Pool unavailable')).mockResolvedValue(undefined);
	const view = render(DataSettings, { snapshot: new Rollup().snapshot(0), cutoverTs: null, onSave });
	const input = view.getByLabelText('Work/personal cutover', { selector: 'input' });
	await fireEvent.input(input, { target: { value: '2026-09-10' } });
	await fireEvent.submit(view.getByRole('form', { name: 'Work/personal cutover' }));
	await waitFor(() => expect(view.getByRole('alert').textContent).toBe('Pool unavailable'));
	expect(input).toHaveProperty('value', '2026-09-10');
	await fireEvent.submit(view.getByRole('form', { name: 'Work/personal cutover' }));
	await waitFor(() => expect(view.getByRole('status').textContent).toBe('Saved'));
	expect(onSave).toHaveBeenLastCalledWith(Date.parse('2026-09-10T00:00:00Z'));
	await fireEvent.input(input, { target: { value: '' } });
	await fireEvent.submit(view.getByRole('form', { name: 'Work/personal cutover' }));
	await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(null));
});
