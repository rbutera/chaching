// Vitest global setup. jest-dom matchers (toBeInTheDocument, etc.) are only meaningful
// in the jsdom component tests; component tests opt into jsdom per-file.
//
// The import is DYNAMIC and window-gated on purpose: setupFiles run once per test
// file, and eagerly pulling jest-dom into the ~85 node-env files that can never use
// a DOM matcher was pure overhead on every one of them. Gating it keeps the matchers
// exactly where they're meaningful.
export {}; // keep this file an ES module so the top-level await below is legal

if (typeof window !== 'undefined') {
	await import('@testing-library/jest-dom/vitest');
}

// jsdom has no layout engine: every element reports 0×0, which starves
// @tanstack/virtual (it measures the scroll element to decide how many rows to
// render, and with a 0px viewport renders none). Give the scroll container +
// its rows a realistic measured size so the virtualizer renders a real window.
// Guarded to the jsdom env so the node suite is untouched.
if (typeof window !== 'undefined' && typeof Element !== 'undefined') {
	const VIEWPORT = 460; // matches SessionExplorer .scroll max-height
	const ROW = 56;

	Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
		configurable: true,
		get(this: HTMLElement) {
			if (this.classList?.contains('scroll')) return VIEWPORT;
			if (this.classList?.contains('row')) return ROW;
			return VIEWPORT;
		}
	});
	Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
		configurable: true,
		get: () => 600
	});

	const origRect = Element.prototype.getBoundingClientRect;
	Element.prototype.getBoundingClientRect = function (this: Element) {
		if (this instanceof HTMLElement && this.classList?.contains('scroll')) {
			return { width: 600, height: VIEWPORT, top: 0, left: 0, right: 600, bottom: VIEWPORT, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
		}
		if (this instanceof HTMLElement && this.classList?.contains('row')) {
			return { width: 600, height: ROW, top: 0, left: 0, right: 600, bottom: ROW, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
		}
		return origRect.call(this);
	};
}
