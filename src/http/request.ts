export function optionalString(value: unknown) {
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export function routeParam(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}
