import { join } from 'node:path';

export function distributionRoot(): string {
	const root = process.env.CHACHING_PACKAGE_ROOT;
	if (!root) throw new Error('Package root was not set by the chaching launcher.');
	return root;
}

export function assetRoot(): string {
	return join(distributionRoot(), 'assets');
}
