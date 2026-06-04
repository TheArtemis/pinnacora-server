-- Ensure a tournament can only have one unfinished game at a time.
CREATE UNIQUE INDEX "Game_one_active_per_tournament_idx"
ON "Game"("tournamentId")
WHERE "status" IN ('WAITING'::"GameStatus", 'PLAYING'::"GameStatus");
