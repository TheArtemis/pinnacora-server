import { GameStatus } from "../generated/prisma/client";
import { serializeUser } from "../users/serializers";
import type { GameWithWinner, ParticipantWithUser, TournamentWithDetails } from "./types";

function buildStandings(participants: ParticipantWithUser[], games: GameWithWinner[]) {
    const finishedGames = games.filter((game) => game.status === GameStatus.FINISHED);
    const standings = new Map(
        participants.map((participant) => [
            participant.userId,
            {
                user: serializeUser(participant.user),
                gamesPlayed: finishedGames.length,
                wins: 0,
            },
        ]),
    );

    for (const game of finishedGames) {
        if (!game.winnerId) {
            continue;
        }

        const winnerStanding = standings.get(game.winnerId);
        if (winnerStanding) {
            winnerStanding.wins += 1;
        }
    }

    return [...standings.values()].sort((left, right) => right.wins - left.wins);
}

export function serializeTournament(tournament: TournamentWithDetails) {
    const finishedGames = tournament.games.filter((game) => game.status === GameStatus.FINISHED);

    return {
        id: tournament.id,
        name: tournament.name,
        joinCode: tournament.joinCode,
        status: tournament.status,
        createdAt: tournament.createdAt,
        completedAt: tournament.completedAt,
        participants: tournament.participants.map((participant) => ({
            id: participant.id,
            joinedAt: participant.joinedAt,
            user: serializeUser(participant.user),
        })),
        games: tournament.games.map(serializeGame),
        results: {
            totalGames: tournament.games.length,
            finishedGames: finishedGames.length,
            standings: buildStandings(tournament.participants, tournament.games),
        },
    };
}

export function serializeGame(game: GameWithWinner) {
    return {
        id: game.id,
        roomCode: game.roomCode,
        status: game.status,
        startedAt: game.startedAt,
        finishedAt: game.finishedAt,
        winner: game.winner ? serializeUser(game.winner) : null,
    };
}
