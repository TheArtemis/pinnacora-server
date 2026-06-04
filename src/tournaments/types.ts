import type {
    Game,
    Tournament,
    TournamentParticipant,
    User,
} from "../generated/prisma/client";

export type TournamentRequestBody = {
    name?: unknown;
    joinCode?: unknown;
    winnerId?: unknown;
};

export type ParticipantWithUser = TournamentParticipant & {
    user: User;
};

export type GameWithWinner = Game & {
    winner: User | null;
};

export type TournamentWithDetails = Tournament & {
    participants: ParticipantWithUser[];
    games: GameWithWinner[];
};
