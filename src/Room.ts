import { MatrixEvent, MessageEventContent, MatrixClient, RichReply } from "matrix-bot-sdk";

export const ChallengeRoomStateEventType = "uk.half-shot.matrix-challenger.activity";
export interface IChallengeRoomStateFile {
    url: string;
}

export const ChallengeRoomStateGlobalConfigEventType = "uk.half-shot.matrix-challenger.globalconfig";
export interface IRoomStateGlobalConfig {
    adminUsers: string[];
}

import markdownit from "markdown-it";
import { IActivity } from "./IPayload";
const md = markdownit();

function getEmojiForType(type: string) {
    switch (type) {
        case "run":
            return "🏃";
        case "virtualrun":
            return "👨‍💻🏃";
        case "ride":
        case "cycle":
        case "cycling":
            return "🚴";
        case "virtualride":
            return "👨‍💻🚴";
        case "walk":
        case "hike":
            return "🚶";
        case "skateboard":
            return "🛹";
        case "virtualwalk":
        case "virtualhike":
            return "👨‍💻🚶";
        default:
            return "🕴️";
    }
}

export class ChallengeRoom {
    public static async createState(roomId: string, url: string, client: MatrixClient) {
        await client.sendStateEvent(roomId, ChallengeRoomStateEventType, url, {
            url,
        } as IChallengeRoomStateFile);
    }

    public readonly processedActivites = new Set<string>();
    constructor(public readonly roomId: string, public readonly stateKey: string, private state: IChallengeRoomStateFile, private client: MatrixClient, existingIds: string[]) {
        existingIds.forEach(id => this.processedActivites.add(id));
    }

    public targetDistance: number = 0;
    public targetDuration: number = 0;

    public totalDistance: number = 0;
    public totalDuration: number = 0;

    public get challengeUrl() {
        return this.state.url;
    }

    public async onMessageEvent(event: MatrixEvent<MessageEventContent>) {

    }

    public async handleNewActivity(payload: IActivity) {
        this.processedActivites.add(payload.id);
        const distance = `${(payload.distance / 1000).toFixed(2)}km`;
        const emoji = getEmojiForType(payload.activityType);
        const body = `🎉 **${payload.user.fname}** completed a ${distance} ${emoji} ${payload.activityType} (${payload.activityName})`;
        const content: any = {
            body,
            format: "org.matrix.custom.html",
            formatted_body: md.renderInline(body),
        };
        content["msgtype"] = "m.notice";
        content["uk.half-shot.matrix-challenger.activity.id"] = payload.id;
        content["uk.half-shot.matrix-challenger.activity.distance"] = Math.round(payload.distance);
        content["uk.half-shot.matrix-challenger.activity.elevation"] = Math.round(payload.elevation);
        content["uk.half-shot.matrix-challenger.activity.duration"] = Math.round(payload.duration);
        content["uk.half-shot.matrix-challenger.activity.user"] = {
            "name": payload.user.fullname,
            id: payload.user.id,
        };
        await this.client.sendMessage(this.roomId, content);
    }

    public async handleDistanceIncrease(newTotalDistance: number, percentage: number) {
        const distance = `${(newTotalDistance / 1000).toFixed(2)}km`;
        const body = `✨ The team has now completed ${percentage}% of the target, covering a total distance of ${distance}!`;
        const content: any = {
            body,
            format: "org.matrix.custom.html",
            formatted_body: md.renderInline(body),
        };
        content["msgtype"] = "m.notice";
        content["uk.half-shot.matrix-challenger.activity.distance"] = this.totalDistance;
        await this.client.sendMessage(this.roomId, content);
    }

    public async updateState(state: IChallengeRoomStateFile) {
        this.state = state;
    }
}
