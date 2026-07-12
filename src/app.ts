import express from "express";
import {
    isCorsOriginAllowed,
    productionClientUrl,
} from "./config/cors";
import tournamentsRouter from "./routes/tournaments";
import usersRouter from "./routes/users";

export function createApp() {
    const app = express();

    app.use((req, res, next) => {
        const origin = req.headers.origin;
        const allowedOrigin =
            origin && isCorsOriginAllowed(origin) ? origin : productionClientUrl;

        res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
        res.setHeader("Vary", "Origin");
        res.setHeader(
            "Access-Control-Allow-Methods",
            "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        );
        res.setHeader(
            "Access-Control-Allow-Headers",
            "Authorization,Content-Type",
        );

        if (req.method === "OPTIONS") {
            res.sendStatus(204);
            return;
        }

        next();
    });
    app.use(express.json());

    app.get("/health", (_req, res) => {
        res.json({ status: "ok" });
    });

    app.get("/keepalive", (_req, res) => {
        res.sendStatus(204);
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
