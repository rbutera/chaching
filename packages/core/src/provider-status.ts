export class ProviderStatus {
	private errors = new Map<string, string>();

	clear(provider: string): void {
		this.errors.delete(provider);
	}

	recordError(provider: string, error: unknown): void {
		this.errors.set(provider, errorMessage(error));
	}

	recordMessage(provider: string, message: string): void {
		this.errors.set(provider, message);
	}

	snapshot(): Record<string, string> {
		return Object.fromEntries(this.errors);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
