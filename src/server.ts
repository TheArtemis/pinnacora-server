import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import { createApp } from "./app";
import { getCorsOrigins } from "./config/cors";
import { registerGameSocketHandlers } from "./sockets/gameSocket";

const app = createApp();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: getCorsOrigins(),
    },
});

registerGameSocketHandlers(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});