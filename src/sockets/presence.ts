const gameConnections = new Map<string, Map<string, number>>();

export function incrementConnection(roomCode: string, userId: string) {
    const roomConnections = gameConnections.get(roomCode) ?? new Map<string, number>();
    roomConnections.set(userId, (roomConnections.get(userId) ?? 0) + 1);
    gameConnections.set(roomCode, roomConnections);
}

export function decrementConnection(roomCode: string, userId: string) {
    const roomConnections = gameConnections.get(roomCode);

    if (!roomConnections) {
        return;
    }

    const nextCount = (roomConnections.get(userId) ?? 0) - 1;

    if (nextCount > 0) {
        roomConnections.set(userId, nextCount);
    } else {
        roomConnections.delete(userId);
    }

    if (roomConnections.size === 0) {
        gameConnections.delete(roomCode);
    }
}

export function getConnectedPlayerIds(roomCode: string) {
    return new Set(gameConnections.get(roomCode)?.keys() ?? []);
}
