import type { ClientGameState, PersistedGameState } from "./types";

export function serializeGameStateForPlayer(
    state: PersistedGameState,
    viewerPlayerId?: string,
): ClientGameState {
    return {
        id: state.id,
        status: state.status,
        phase: state.phase,
        currentPlayerId: state.currentPlayerId,
        youPlayerId: viewerPlayerId,
        deckCount: state.deck.length,
        discardPile: state.discardPile,
        melds: state.melds,
        players: state.players.map((player) => ({
            id: player.id,
            name: player.name,
            connected: player.connected,
            handCount: player.hand.length,
            hand: player.id === viewerPlayerId ? player.hand : undefined,
        })),
        winnerId: state.winnerId,
    };
}
