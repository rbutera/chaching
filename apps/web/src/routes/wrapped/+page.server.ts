import { yearlyRecap } from '$lib/server/wrapped';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => ({ recap: await yearlyRecap(url), redact: url.searchParams.get('redact') === '1' });
