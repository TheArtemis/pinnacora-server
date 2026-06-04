import { Router } from "express";
import type { Request, Response } from "express";
import { TournamentStatus } from "../generated/prisma/client";
import { requireFirebaseAuth, type AuthenticatedRequest } from "../auth/firebase";
import { optionalString, routeParam } from "../http/request";
import { serializeGame, serializeTournament } from "../tournaments/serializers";
import {
  completeTournament,
  createOrFindActiveGame,
  createTournamentForUser,
  findTournamentByJoinCode,
  findTournamentForUser,
  findTournamentGame,
  finishTournamentGame,
  getCurrentUserByFirebaseUid,
  joinTournament,
  listTournamentsForUser,
  normalizeTournamentStatus,
} from "../tournaments/service";
import type { TournamentRequestBody } from "../tournaments/types";

const router = Router();

async function getCurrentUser(req: Request, res: Response) {
  const firebaseUser = (req as AuthenticatedRequest).firebaseUser;
  const user = await getCurrentUserByFirebaseUid(firebaseUser.uid);

  if (!user) {
    res.status(404).json({ error: "User has not been created yet." });
    return undefined;
  }

  return user;
}

router.get("/", requireFirebaseAuth, async (req: Request, res: Response) => {
  const user = await getCurrentUser(req, res);

  if (!user) {
    return;
  }

  const statusParam = optionalString(req.query.status)?.toUpperCase();
  const tournaments = await listTournamentsForUser(user.id, normalizeTournamentStatus(statusParam));

  res.json({ tournaments: tournaments.map(serializeTournament) });
});

router.post("/", requireFirebaseAuth, async (req: Request, res: Response) => {
  const user = await getCurrentUser(req, res);

  if (!user) {
    return;
  }

  const body = req.body as TournamentRequestBody;
  const name = optionalString(body.name) ?? "Pinnacora Tournament";
  const tournament = await createTournamentForUser(user.id, name);

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

  const tournament = await findTournamentByJoinCode(joinCode);

  if (!tournament) {
    res.status(404).json({ error: "Tournament not found." });
    return;
  }

  if (tournament.status === TournamentStatus.COMPLETED) {
    res.status(409).json({ error: "This tournament has already been completed." });
    return;
  }

  await joinTournament(tournament.id, user.id);

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

  const completedTournament = await completeTournament(tournament.id);

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

  const { game, created } = await createOrFindActiveGame(tournament);

  res.status(created ? 201 : 200).json({
    game: serializeGame(game),
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

    const game = await findTournamentGame(gameId, tournament.id);

    if (!game) {
      res.status(404).json({ error: "Game not found." });
      return;
    }

    const finishedGame = await finishTournamentGame(game.id, winnerId);

    res.json({
      game: serializeGame(finishedGame),
    });
  },
);

export default router;
