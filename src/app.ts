import cors from "cors";
import express from "express";
import { getCorsOrigins } from "./config/cors";
import tournamentsRouter from "./routes/tournaments";
import usersRouter from "./routes/users";

export function createApp() {
    const app = express();

    app.use(cors({ origin: getCorsOrigins() }));
    app.use(express.json());

    app.get("/health", (_req, res) => {
        res.json({ status: "ok" });
    });

    app.use("/users", usersRouter);
    app.use("/tournaments", tournamentsRouter);

    app.use(
        (
            err: unknown,
            _req: express.Request,
            res: express.Response,
            _next: express.NextFunction,
        ) => {
            console.error(err);
            res.status(500).json({ error: "Internal server error." });
        },
    );

    return app;
}
