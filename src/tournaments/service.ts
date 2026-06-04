import { GameStatus, TournamentStatus } from "../generated/prisma/client";
import { prisma } from "../db";
import { isUniqueConstraintError } from "../db/errors";
import type { TournamentWithDetails } from "./types";

export const activeGameStatuses: GameStatus[] = [GameStatus.WAITING, GameStatus.PLAYING];

const tournamentDetailsInclude = {
    participants: {
        include: { user: true },
        orderBy: { joinedAt: "asc" as const },
    },
    games: {
        include: { winner: true },
        orderBy: { createdAt: "desc" as const },
    },
};

function createCode(length = 6) {
    return Math.random().toString(36).slice(2, 2 + length).toUpperCase();
}

async function createUniqueJoinCode() {
    for (let attempts = 0; attempts < 10; attempts += 1) {
        const joinCode = createCode();
        const existing = await prisma.tournament.findUnique({ where: { joinCode } });

        if (!existing) {
            return joinCode;
        }
    }

    throw new Error("Could not create a unique tournament join code.");
}

async function createUniqueRoomCode() {
    for (let attempts = 0; attempts < 10; attempts += 1) {
        const roomCode = createCode();
        const existing = await prisma.game.findUnique({ where: { roomCode } });

        if (!existing) {
            return roomCode;
        }
    }

    throw new Error("Could not create a unique game room code.");
}

export function normalizeTournamentStatus(status?: string) {
    return status === TournamentStatus.ACTIVE || status === TournamentStatus.COMPLETED
        ? status
        : undefined;
}

export function getCurrentUserByFirebaseUid(firebaseUid: string) {
    return prisma.user.findUnique({
        where: { firebaseUid },
    });
}

export function listTournamentsForUser(userId: string, status?: TournamentStatus) {
    return prisma.tournament.findMany({
        where: {
            status,
            participants: {
                some: { userId },
            },
        },
        include: tournamentDetailsInclude,
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
}

export function findTournamentForUser(tournamentId: string, userId: string) {
    return prisma.tournament.findFirst({
        where: {
            id: tournamentId,
            participants: {
                some: { userId },
            },
        },
        include: tournamentDetailsInclude,
    });
}

export async function createTournamentForUser(userId: string, name: string) {
    const joinCode = await createUniqueJoinCode();

    return prisma.tournament.create({
        data: {
            name,
            joinCode,
            creatorId: userId,
            participants: {
                create: {
                    userId,
                },
            },
        },
        include: tournamentDetailsInclude,
    });
}

export function findTournamentByJoinCode(joinCode: string) {
    return prisma.tournament.findUnique({
        where: { joinCode },
    });
}

export function joinTournament(tournamentId: string, userId: string) {
    return prisma.tournamentParticipant.upsert({
        where: {
            tournamentId_userId: {
                tournamentId,
                userId,
            },
        },
        update: {},
        create: {
            tournamentId,
            userId,
        },
    });
}

export function completeTournament(tournamentId: string) {
    return prisma.tournament.update({
        where: { id: tournamentId },
        data: {
            status: TournamentStatus.COMPLETED,
            completedAt: new Date(),
        },
        include: tournamentDetailsInclude,
    });
}

export async function createOrFindActiveGame(tournament: TournamentWithDetails) {
    const activeGame = tournament.games.find((game) => activeGameStatuses.includes(game.status));

    if (activeGame) {
        return { game: activeGame, created: false };
    }

    const roomCode = await createUniqueRoomCode();

    try {
        const game = await prisma.game.create({
            data: {
                tournamentId: tournament.id,
                roomCode,
                status: GameStatus.WAITING,
            },
            include: { winner: true },
        });

        return { game, created: true };
    } catch (createError) {
        if (!isUniqueConstraintError(createError)) {
            throw createError;
        }

        const existingActiveGame = await prisma.game.findFirst({
            where: {
                tournamentId: tournament.id,
                status: { in: activeGameStatuses },
            },
            include: { winner: true },
            orderBy: { createdAt: "desc" },
        });

        if (!existingActiveGame) {
            throw createError;
        }

        return { game: existingActiveGame, created: false };
    }
}

export function findTournamentGame(gameId: string, tournamentId: string) {
    return prisma.game.findFirst({
        where: {
            id: gameId,
            tournamentId,
        },
    });
}

export function finishTournamentGame(gameId: string, winnerId: string) {
    return prisma.game.update({
        where: { id: gameId },
        data: {
            status: GameStatus.FINISHED,
            winnerId,
            finishedAt: new Date(),
        },
        include: { winner: true },
    });
}
