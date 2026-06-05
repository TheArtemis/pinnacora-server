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

export type GameMeldType = "set" | "sequence";

export type GameMeld = {
    id: string;
    playerId: string;
    type: GameMeldType;
    cards: Card[];
};

export type PersistedGameState = {
    version: 1;
    id: string;
    status: PlayStatus;
    phase: GamePhase;
    players: GamePlayer[];
    deck: Card[];
    discardPile: Card[];
    melds: GameMeld[];
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
    melds: GameMeld[];
    currentPlayerId?: string;
    youPlayerId?: string;
};
