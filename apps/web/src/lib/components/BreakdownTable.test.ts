// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/svelte';
import BreakdownTable from './BreakdownTable.svelte';

describe('BreakdownTable', () => {
	it.each([['Models', 12], ['Projects', 140]] as const)('keeps %s bounded, searchable and sortable across updates', async (label, count) => {
		const rows = Array.from({ length: count }, (_, i) => ({
			id: String(i), name: 'Item ' + String(i).padStart(3, '0'), detail: '/workspace/' + i,
			cost: i + 1, tokens: i * 100, count: i
		}));
		const onToggle = vi.fn();
		const target = rows[count - 1];
		const { getByRole, getByLabelText, container, rerender } = render(BreakdownTable, { rows, label, countLabel: 'Requests', onToggle });
		const table = getByRole('table', { name: label });
		expect(container.querySelectorAll('tbody tr')).toHaveLength(8);
		expect(container.querySelector('tbody tr')).toHaveTextContent(rows[count - 1].name);
		await fireEvent.click(getByRole('button', { name: 'Next ' + label.toLowerCase() + ' page' }));
		expect(container.querySelectorAll('tbody tr').length).toBeLessThanOrEqual(8);
		expect(container.querySelector('tbody tr')).toHaveTextContent(rows[count - 9].name);
		await fireEvent.input(getByLabelText('Search ' + label.toLowerCase()), { target: { value: target.detail } });
		expect(within(table).getByRole('button', { name: target.name })).toBeTruthy();
		await fireEvent.click(getByRole('button', { name: /^Spend/ }));
		expect(within(table).getByRole('columnheader', { name: /^Spend/ })).toHaveAttribute('aria-sort', 'ascending');
		await rerender({ rows: rows.map(row => ({ ...row, cost: row.cost * 2 })), label, countLabel: 'Requests', onToggle });
		expect(getByLabelText('Search ' + label.toLowerCase())).toHaveValue(target.detail);
		expect(within(table).getByRole('columnheader', { name: /^Spend/ })).toHaveAttribute('aria-sort', 'ascending');
		await fireEvent.click(within(table).getByRole('button', { name: target.name }));
		expect(onToggle).toHaveBeenCalledWith(target.id);
	});
});
