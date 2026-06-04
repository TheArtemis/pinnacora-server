const localClientUrls = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
];

export function getCorsOrigins() {
    const configuredClientUrls = process.env.CLIENT_URL
        ?.split(",")
        .map((url) => url.trim())
        .filter(Boolean) ?? [];

    return [...new Set([...configuredClientUrls, ...localClientUrls])];
}
