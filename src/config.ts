import { ProfileCache } from "matrix-bot-sdk";

export default {
    "token": process.env.CHOUND_TOKEN as string,
    "matrixOpts": {
        "homeserverUrl": process.env.MATRIX_HOMESERVER_URL as string,
        "accessToken": process.env.MATRIX_ACCESS_TOKEN as string,
    },
    "adminRoom": process.env.ADMIN_ROOM as string,
}