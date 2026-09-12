import { dev } from '$app/environment';
import { assetRoot } from '@chaching/core/runtime-assets';

declare const __CHACHING_DEV_ASSET_ROOT__: string;

export function receiptAssetRoot(): string {
	return dev ? __CHACHING_DEV_ASSET_ROOT__ : assetRoot();
}
