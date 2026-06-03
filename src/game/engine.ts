export type CardSuit = "clubs" | "diamonds" | "hearts" | "spades" | "joker";

export type CardRank =
    | "A"
    | "2"
    | "3"
    | "4"
    | "5"
    | "6"
    | "7"
    | "8"
    | "9"
    | "10"
    | "J"
    | "Q"
    | "K"
    | "JOKER";

export type Card = {
    id: string;
    suit: CardSuit;
    rank: CardRank;
};

export type GamePhase = "waiting" | "draw" | "discard" | "finished";
export type PlayStatus = "waiting" | "playing" | "paused" | "finished";

export type GameParticipant = {
    id: string;
    name: string;
};

export type GamePlayer = GameParticipant & {
    hand: Card[];
    connected: boolean;
};

export type PersistedGameState = {
    version: 1;
    id: string;
    status: PlayStatus;
    phase: GamePhase;
    players: GamePlayer[];
    deck: Card[];
    discardPile: Card[];
    currentPlayerId?: string;
};

export type ClientGamePlayer = {
    id: string;
    name: string;
    connected: boolean;
    handCount: number;
    hand?: Card[];
};

export type ClientGameState = {
    id: string;
    status: PlayStatus;
    phase: GamePhase;
    players: ClientGamePlayer[];
    deckCount: number;
    discardPile: Card[];
    currentPlayerId?: string;
    youPlayerId?: string;
};

const suits: CardSuit[] = ["clubs", "diamonds", "hearts", "spades"];
const ranks: Exclude<CardRank, "JOKER">[] = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
];
const cardsPerPlayer = 14;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCard(value: unknown): value is Card {
    if (!isRecord(value)) {
        return false;
    }

    return typeof value.id === "string" && typeof value.suit === "string" && typeof value.rank === "string";
}

function isCardArray(value: unknown): value is Card[] {
    return Array.isArray(value) && value.every(isCard);
}

function isPlayer(value: unknown): value is GamePlayer {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        typeof value.connected === "boolean" &&
        isCardArray(value.hand)
    );
}

function isPersistedGameState(value: unknown): value is PersistedGameState {
    if (!isRecord(value)) {
        return false;
    }

    return (
        value.version === 1 &&
        typeof value.id === "string" &&
        typeof value.status === "string" &&
        typeof value.phase === "string" &&
        Array.isArray(value.players) &&
        value.players.every(isPlayer) &&
        isCardArray(value.deck) &&
        isCardArray(value.discardPile) &&
        (value.currentPlayerId === undefined || typeof value.currentPlayerId === "string")
    );
}

function playerName(participant: GameParticipant) {
    return participant.name.trim() || "Player";
}

export function createDeck(): Card[] {
    const cards: Card[] = [];

    for (let deckIndex = 1; deckIndex <= 2; deckIndex += 1) {
        for (const suit of suits) {
            for (const rank of ranks) {
                cards.push({
                    id: `deck-${deckIndex}-${rank}-${suit}`,
                    suit,
                    rank,
                });
            }
        }

        cards.push({
            id: `deck-${deckIndex}-JOKER`,
            suit: "joker",
            rank: "JOKER",
        });
    }

    return cards;
}

export function shuffleDeck(deck: Card[]) {
    const shuffled = [...deck];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        const currentCard = shuffled[index];
        const swappedCard = shuffled[swapIndex];

        if (!currentCard || !swappedCard) {
            continue;
        }

        shuffled[index] = swappedCard;
        shuffled[swapIndex] = currentCard;
    }

    return shuffled;
}

export function createWaitingGameState(gameId: string, participants: GameParticipant[]): PersistedGameState {
    return {
        version: 1,
        id: gameId,
        status: "waiting",
        phase: "waiting",
        players: participants.map((participant) => ({
            id: participant.id,
            name: playerName(participant),
            connected: false,
            hand: [],
        })),
        deck: [],
        discardPile: [],
    };
}

export function restoreGameState(
    storedState: unknown,
    gameId: string,
    participants: GameParticipant[],
): PersistedGameState {
    if (!isPersistedGameState(storedState)) {
        return createWaitingGameState(gameId, participants);
    }

    const playerStates = new Map(storedState.players.map((player) => [player.id, player]));

    return {
        ...storedState,
        id: gameId,
        players: participants.map((participant) => {
            const storedPlayer = playerStates.get(participant.id);

            return {
                id: participant.id,
                name: playerName(participant),
                connected: storedPlayer?.connected ?? false,
                hand: storedPlayer?.hand ?? [],
            };
        }),
    };
}

export function syncPresence(state: PersistedGameState, connectedPlayerIds: Set<string>): PersistedGameState {
    if (state.status === "finished") {
        return state;
    }

    const players = state.players.map((player) => ({
        ...player,
        connected: connectedPlayerIds.has(player.id),
    }));
    const allPlayersConnected = players.length === 2 && players.every((player) => player.connected);

    if (state.status === "waiting") {
        return {
            ...state,
            players,
        };
    }

    return {
        ...state,
        status: allPlayersConnected ? "playing" : "paused",
        players,
    };
}

export function maybeStartGame(state: PersistedGameState): PersistedGameState {
    if (state.status !== "waiting" || state.players.length !== 2 || !state.players.every((player) => player.connected)) {
        return state;
    }

    const deck = shuffleDeck(createDeck());
    const players = state.players.map((player) => ({
        ...player,
        hand: deck.splice(0, cardsPerPlayer),
    }));

    return {
        ...state,
        status: "playing",
        phase: "draw",
        players,
        deck,
        discardPile: [],
        currentPlayerId: players[0]?.id,
    };
}

export function drawCard(state: PersistedGameState, playerId: string) {
    if (state.status !== "playing") {
        return { error: "The game is not currently playable." };
    }

    if (state.currentPlayerId !== playerId) {
        return { error: "It is not your turn." };
    }

    if (state.phase !== "draw") {
        return { error: "You must discard before drawing again." };
    }

    const [drawnCard, ...deck] = state.deck;

    if (!drawnCard) {
        return { error: "The deck is empty." };
    }

    return {
        state: {
            ...state,
            phase: "discard" as const,
            deck,
            players: state.players.map((player) =>
                player.id === playerId
                    ? {
                        ...player,
                        hand: [...player.hand, drawnCard],
                    }
                    : player,
            ),
        },
    };
}

export function discardCard(state: PersistedGameState, playerId: string, cardId: string) {
    if (state.status !== "playing") {
        return { error: "The game is not currently playable." };
    }

    if (state.currentPlayerId !== playerId) {
        return { error: "It is not your turn." };
    }

    if (state.phase !== "discard") {
        return { error: "Draw a card before discarding." };
    }

    const currentPlayerIndex = state.players.findIndex((player) => player.id === playerId);
    const currentPlayer = state.players[currentPlayerIndex];

    if (!currentPlayer) {
        return { error: "Player is not in this game." };
    }

    const cardIndex = currentPlayer.hand.findIndex((card) => card.id === cardId);
    const discardedCard = currentPlayer.hand[cardIndex];

    if (!discardedCard) {
        return { error: "That card is not in your hand." };
    }

    const nextPlayer = state.players[(currentPlayerIndex + 1) % state.players.length];

    return {
        state: {
            ...state,
            phase: "draw" as const,
            currentPlayerId: nextPlayer?.id,
            discardPile: [...state.discardPile, discardedCard],
            players: state.players.map((player) =>
                player.id === playerId
                    ? {
                        ...player,
                        hand: player.hand.filter((card) => card.id !== cardId),
                    }
                    : player,
            ),
        },
    };
}

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
        players: state.players.map((player) => ({
            id: player.id,
            name: player.name,
            connected: player.connected,
            handCount: player.hand.length,
            hand: player.id === viewerPlayerId ? player.hand : undefined,
        })),
    };
}
