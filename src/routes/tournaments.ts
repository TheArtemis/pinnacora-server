import { Router } from "express";
import type { Request, Response } from "express";
import {
  GameStatus,
  TournamentStatus,
  type Game,
  type Tournament,
  type TournamentParticipant,
  type User,
} from "../generated/prisma/client";
import { requireFirebaseAuth, type AuthenticatedRequest } from "../auth/firebase";
import { prisma } from "../db";

type TournamentRequestBody = {
  name?: unknown;
  joinCode?: unknown;
  winnerId?: unknown;
};

type ParticipantWithUser = TournamentParticipant & {
  user: User;
};

type GameWithWinner = Game & {
  winner: User | null;
};

type TournamentWithDetails = Tournament & {
  participants: ParticipantWithUser[];
  games: GameWithWinner[];
};

const router = Router();

function optionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function createCode(length = 6) {
  return Math.random().toString(36).slice(2, 2 + length).toUpperCase();
}

function serializeUser(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    photoUrl: user.photoUrl,
  };
}

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

function serializeTournament(tournament: TournamentWithDetails) {
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
    games: tournament.games.map((game) => ({
      id: game.id,
      roomCode: game.roomCode,
      status: game.status,
      startedAt: game.startedAt,
      finishedAt: game.finishedAt,
      winner: game.winner ? serializeUser(game.winner) : null,
    })),
    results: {
      totalGames: tournament.games.length,
      finishedGames: finishedGames.length,
      standings: buildStandings(tournament.participants, tournament.games),
    },
  };
}

async function getCurrentUser(req: Request, res: Response) {
  const firebaseUser = (req as AuthenticatedRequest).firebaseUser;
  const user = await prisma.user.findUnique({
    where: { firebaseUid: firebaseUser.uid },
  });

  if (!user) {
    res.status(404).json({ error: "User has not been created yet." });
    return undefined;
  }

  return user;
}

async function findTournamentForUser(tournamentId: string, userId: string) {
  return prisma.tournament.findFirst({
    where: {
      id: tournamentId,
      participants: {
        some: { userId },
      },
    },
    include: {
      participants: {
        include: { user: true },
        orderBy: { joinedAt: "asc" },
      },
      games: {
        include: { winner: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
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

router.get("/", requireFirebaseAuth, async (req: Request, res: Response) => {
  const user = await getCurrentUser(req, res);

  if (!user) {
    return;
  }

  const statusParam = optionalString(req.query.status)?.toUpperCase();
  const status =
    statusParam === TournamentStatus.ACTIVE || statusParam === TournamentStatus.COMPLETED
      ? statusParam
      : undefined;

  const tournaments = await prisma.tournament.findMany({
    where: {
      status,
      participants: {
        some: { userId: user.id },
      },
    },
    include: {
      participants: {
        include: { user: true },
        orderBy: { joinedAt: "asc" },
      },
      games: {
        include: { winner: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  res.json({ tournaments: tournaments.map(serializeTournament) });
});

router.post("/", requireFirebaseAuth, async (req: Request, res: Response) => {
  const user = await getCurrentUser(req, res);

  if (!user) {
    return;
  }

  const body = req.body as TournamentRequestBody;
  const name = optionalString(body.name) ?? "Pinnacora Tournament";
  const joinCode = await createUniqueJoinCode();

  const tournament = await prisma.tournament.create({
    data: {
      name,
      joinCode,
      creatorId: user.id,
      participants: {
        create: {
          userId: user.id,
        },
      },
    },
    include: {
      participants: {
        include: { user: true },
        orderBy: { joinedAt: "asc" },
      },
      games: {
        include: { winner: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  res.status(201).json({ tournament: serializeTournament(tournament) });
});

router.post("/join", requireFirebaseAuth, async (req: Request, res: Response) => {
  const user = await getCurrentUser(req, res);

  if (!user) {
    return;
  }

  const body = req.body as TournamentRequestBody;
  const joinCode = optionalString(body.joinCode)?.toUpperCase();

  if (!joinCode) {
    res.status(400).json({ error: "Tournament join code is required." });
    return;
  }

  const tournament = await prisma.tournament.findUnique({
    where: { joinCode },
  });

  if (!tournament) {
    res.status(404).json({ error: "Tournament not found." });
    return;
  }

  if (tournament.status === TournamentStatus.COMPLETED) {
    res.status(409).json({ error: "This tournament has already been completed." });
    return;
  }

  await prisma.tournamentParticipant.upsert({
    where: {
      tournamentId_userId: {
        tournamentId: tournament.id,
        userId: user.id,
      },
    },
    update: {},
    create: {
      tournamentId: tournament.id,
      userId: user.id,
    },
  });

  const joinedTournament = await findTournamentForUser(tournament.id, user.id);
  res.json({ tournament: joinedTournament ? serializeTournament(joinedTournament) : null });
});

router.get("/:id", requireFirebaseAuth, async (req: Request, res: Response) => {
  const user = await getCurrentUser(req, res);
  const tournamentId = routeParam(req.params.id);

  if (!user || !tournamentId) {
    return;
  }

  const tournament = await findTournamentForUser(tournamentId, user.id);

  if (!tournament) {
    res.status(404).json({ error: "Tournament not found." });
    return;
  }

  res.json({ tournament: serializeTournament(tournament) });
});

router.post("/:id/complete", requireFirebaseAuth, async (req: Request, res: Response) => {
  const user = await getCurrentUser(req, res);
  const tournamentId = routeParam(req.params.id);

  if (!user || !tournamentId) {
    return;
  }

  const tournament = await findTournamentForUser(tournamentId, user.id);

  if (!tournament) {
    res.status(404).json({ error: "Tournament not found." });
    return;
  }

  const completedTournament = await prisma.tournament.update({
    where: { id: tournament.id },
    data: {
      status: TournamentStatus.COMPLETED,
      completedAt: new Date(),
    },
    include: {
      participants: {
        include: { user: true },
        orderBy: { joinedAt: "asc" },
      },
      games: {
        include: { winner: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  res.json({ tournament: serializeTournament(completedTournament) });
});

router.post("/:id/games", requireFirebaseAuth, async (req: Request, res: Response) => {
  const user = await getCurrentUser(req, res);
  const tournamentId = routeParam(req.params.id);

  if (!user || !tournamentId) {
    return;
  }

  const tournament = await findTournamentForUser(tournamentId, user.id);

  if (!tournament) {
    res.status(404).json({ error: "Tournament not found." });
    return;
  }

  if (tournament.status === TournamentStatus.COMPLETED) {
    res.status(409).json({ error: "This tournament has already been completed." });
    return;
  }

  if (tournament.participants.length !== 2) {
    res.status(409).json({ error: "A game needs exactly two tournament players." });
    return;
  }

  const roomCode = await createUniqueRoomCode();
  const game = await prisma.game.create({
    data: {
      tournamentId: tournament.id,
      roomCode,
      status: GameStatus.WAITING,
    },
    include: { winner: true },
  });

  res.status(201).json({
    game: {
      id: game.id,
      roomCode: game.roomCode,
      status: game.status,
      startedAt: game.startedAt,
      finishedAt: game.finishedAt,
      winner: null,
    },
  });
});

router.post(
  "/:id/games/:gameId/finish",
  requireFirebaseAuth,
  async (req: Request, res: Response) => {
    const user = await getCurrentUser(req, res);
    const tournamentId = routeParam(req.params.id);
    const gameId = routeParam(req.params.gameId);

    if (!user || !tournamentId || !gameId) {
      return;
    }

    const tournament = await findTournamentForUser(tournamentId, user.id);

    if (!tournament) {
      res.status(404).json({ error: "Tournament not found." });
      return;
    }

    const body = req.body as TournamentRequestBody;
    const requestedWinnerId = optionalString(body.winnerId);
    const winnerId = requestedWinnerId ?? user.id;
    const winnerIsParticipant = tournament.participants.some(
      (participant) => participant.userId === winnerId,
    );

    if (!winnerIsParticipant) {
      res.status(400).json({ error: "Winner must be a tournament participant." });
      return;
    }

    const game = await prisma.game.findFirst({
      where: {
        id: gameId,
        tournamentId: tournament.id,
      },
    });

    if (!game) {
      res.status(404).json({ error: "Game not found." });
      return;
    }

    const finishedGame = await prisma.game.update({
      where: { id: game.id },
      data: {
        status: GameStatus.FINISHED,
        winnerId,
        finishedAt: new Date(),
      },
      include: { winner: true },
    });

    res.json({
      game: {
        id: finishedGame.id,
        roomCode: finishedGame.roomCode,
        status: finishedGame.status,
        startedAt: finishedGame.startedAt,
        finishedAt: finishedGame.finishedAt,
        winner: finishedGame.winner ? serializeUser(finishedGame.winner) : null,
      },
    });
  },
);

export default router;
