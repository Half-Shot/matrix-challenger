import { MatrixClient, MatrixEvent, MessageEventContent, MembershipEventContent,
    AutojoinUpgradedRoomsMixin, StateEvent, LogService, LogLevel } from "matrix-bot-sdk";
import config from "./config";
import { ChallengeRoomStateGlobalConfigEventType, IRoomStateGlobalConfig,
    ChallengeRoom, IChallengeRoomStateFile, ChallengeRoomStateEventType } from "./Room";
import axios, { AxiosInstance } from "axios";
import { IActivity, IChallenge, ILeader } from "./IPayload";

LogService.setLevel(LogLevel.INFO);

class ChallengerApp {
    private houndClient: AxiosInstance;
    private matrixClient: MatrixClient;
    private globalState!: IRoomStateGlobalConfig;
    private permittedMembers!: Set<string>;
    private bridgeRooms: ChallengeRoom[] = [];
    private roomToSync = 0;
    private myUserId: string = "";
    private catchAllRoom: ChallengeRoom;

    constructor() {
        this.houndClient = axios.create({
            headers: {
                'Authorization': config.token,
            }
        });
        this.matrixClient = new MatrixClient(
            config.matrixOpts.homeserverUrl,
            config.matrixOpts.accessToken
        );
        this.catchAllRoom = new ChallengeRoom(config.adminRoom, "", { url: "" }, this.matrixClient, []);
    }

    private async onInvite(roomId: string, event: MatrixEvent<MembershipEventContent>) {
        if (!this.globalState) {
            // Still starting up, ignore
            return;
        }
        if (!this.permittedMembers.has(event.sender)) {
            console.warn(`Rejecting invite from ${event.sender} because they are not an admin`);
            await this.matrixClient.kickUser(this.matrixClient.getUserId(), roomId, "User is not on the permitted admin user list");
            return;
        }
        await this.matrixClient.joinRoom(roomId);
        let existingRoom = false;
        if (!existingRoom) {
            await this.matrixClient.sendNotice(roomId,
                "Hello 👋. Please give me moderator permissions, and say `challenge track <URL>` to start tracking a Challenge Hound challenge."
            );
        }
    }

    private async onRoomEvent(roomId: string, event: any) {
        if (roomId === config.adminRoom && event.type === "m.room.membership" && event.state_key) {
            console.log("Got membership for admin room:", event.state_key, event.content.membership)
            if (event.content.membership === "join") {
                this.permittedMembers.add(event.state_key);
            } else if (event.content.membership === "ban" || event.content.membership === "leave") {
                this.permittedMembers.delete(event.state_key);
            }
            return;
        }
        if (Date.now() - event.origin_server_ts > 15000) {
            console.log("ignoring old event", event.event_id);
            return;
        }
        console.debug("onRoomEvent => ", roomId, event.event_id, event.type, event.state_key);
        if (event.type === ChallengeRoomStateEventType && event.state_key) {
            // Do we have a room for this already?
            const existingRoom = this.bridgeRooms.find((r) => r.roomId === roomId && r.stateKey === event.state_key);
            if (existingRoom) {
                console.log("Updating state for existing room", event);
                existingRoom.updateState(event.content as IChallengeRoomStateFile);
            } else {
                // Create a new room.
                console.log("Created new room from state", event);
                const state = event.content as IChallengeRoomStateFile;
                this.bridgeRooms.push(new ChallengeRoom(roomId, event.state_key, state, this.matrixClient, []));
            }
        } else if (event.type === ChallengeRoomStateGlobalConfigEventType && event.state_key === "" && roomId === config.adminRoom) {
            console.log("Updating global config to", event.content);
            this.globalState = event.content as IRoomStateGlobalConfig;
        }
        // Otherwise, ignore the event.
    } 

    private async onRoomMessage(roomId: string, event: any) {
        console.debug("onRoomMessage => ", roomId, event.type, event.sender);
        if (event.unsigned?.age && event.unsigned.age > 15000) {
            console.log("ignoring old event");
        }
        if (!event.content.body || event.sender === this.myUserId) {
            // Needs to be a message.
            return;
        }
        // Is it an existing figma room.
        const challengeRooms = this.bridgeRooms.filter(r =>r.roomId === roomId);

        // Is it a construction message?
        const result = /challenge track (\S+)/.exec(event.content.body);
        if (result) {
            if (challengeRooms.find((r) => r.challengeUrl === result[1])) {
                // Ignore repeat attempts to track
                return;
            }
            // It is!
            let resultEmoji = "✅";
            try {
                await ChallengeRoom.createState(roomId, result[1], this.matrixClient);
            } catch (ex) {
                await this.matrixClient.sendNotice(roomId,
                    "Sorry, I need permission to send state events in order to start tracking. You can revoke the permission afterwards."
                );
                resultEmoji = "❌";
                return;
            }
            await this.matrixClient.sendEvent(roomId, "m.reaction", {
                "m.relates_to": {
                    rel_type: "m.annotation",
                    event_id: event.event_id,
                    key: resultEmoji,
                }
            });
            // We don't need to push it, we will get the state reflected back.
            return;
        }

        for (const figmaRoom of challengeRooms) {
            console.log(`Sending event to figma room`);
            await figmaRoom.onMessageEvent(event);
        }
    }

    private async syncRooms() {
        let joinedRooms: string[]|undefined;
        while(joinedRooms === undefined) {
            try {
                joinedRooms = await this.matrixClient.getJoinedRooms();
            } catch (ex) {
                console.warn("Could not get joined rooms, retrying in 5s");
                await new Promise(res => setTimeout(res, 5000));
            }
        }
        for (const roomId of joinedRooms) {
            try {
                const roomState = await this.matrixClient.getRoomState(roomId);
                for (const event of roomState) {
                    const deleted = event.content.deleted || !event.content.url;
                    if (event.type === ChallengeRoomStateEventType && !deleted) {
                        console.log("Created new room from state (sync)", roomId, event.content);
                        // Fetch old messages
                        const {chunk} = await this.matrixClient.doRequest("GET", `/_matrix/client/r0/rooms/${roomId}/messages`, {
                            dir: "b",
                            limit: 50,
                        });
                        const existingActivities = (chunk as MatrixEvent<Record<string,string>>[]).map((ev) => ev.content["uk.half-shot.matrix-challenger.activity.id"]).filter(id => !!id);
                        this.bridgeRooms.push(
                            new ChallengeRoom(roomId, event.state_key, event.content as IChallengeRoomStateFile, this.matrixClient, existingActivities
                        ));
                    }
                    // Else, ignore.
                }
            } catch (ex) {
                console.warn("Couldn't get room state for:", roomId, ex);
            }
        }
    }

    private async fetchActiviesLoop() {
        if (this.bridgeRooms.length === 0) {
            console.warn(`No bridge rooms defined`);
            return;
        }
        const room = this.bridgeRooms[this.roomToSync];
        if (!room) {
            console.debug(`Room ${this.roomToSync} doesn't exist, starting over`);
            this.roomToSync = 0;
            this.fetchActiviesLoop();
            return;
        }
        try {
            console.info(`${new Date().toUTCString()} Fetching activities for ${room.roomId}`);

            if (!room.targetDistance) {
                const resTarget = (await this.houndClient.get(`${room.challengeUrl}`)) as IChallenge;
                room.targetDistance = resTarget.distance;
                room.targetDuration = resTarget.duration;
            }

            const resAct = await this.houndClient.get(`${room.challengeUrl}/activities?limit=5`);
            const activites = resAct.data as IActivity[];
            for (const activity of activites) {
                await this.onNewActivity(activity, room);
            }
            const resLeaders = await this.houndClient.get(`${room.challengeUrl}/leaders`);
            const leaders = resLeaders.data as ILeader[];
            const totalDistance = leaders.map((l) => l.distance).reduce((a,b) => a+b);
            const totalDuration = leaders.map((l) => l.duration).reduce((a,b) => a+b);
            console.info(`Total distance:${totalDistance} duration:${totalDuration}`);

            if (!room.totalDistance) {
                room.totalDistance = totalDistance;
            } else if (totalDistance > room.totalDistance) {
                // Determine if we've gained 10%
                const oldPercentValue = (room.totalDistance / room.targetDistance) * 100;
                const newPercentValue = (totalDistance / room.targetDistance) * 100;
                console.info(`${oldPercentValue} Fetching activities for ${newPercentValue}`);
                if (Math.floor(oldPercentValue / 10) < Math.floor(newPercentValue / 10)) {
                    // increase of 10%
                    await room.handleDistanceIncrease(totalDistance, newPercentValue);
                }
                room.totalDistance = totalDistance;
            }

            if (!room.totalDuration) {
                room.totalDuration = totalDuration;
            } else if (totalDuration > room.totalDuration) {

            }

        } catch (ex) {
            console.error(`Failed to fetch activities for room:`, ex);
        }

        this.roomToSync++;
    }

    private async onNewActivity(activity: IActivity, room: ChallengeRoom) {
        console.log("Got activity:", activity.id, activity.user.fullname, activity.createdAt);
        // We need to check if the comment was actually new.
        // There isn't a way to tell how the comment has changed, so for now check the timestamps
        if (room.processedActivites.has(activity.id)) {
            console.log("Activity is a dupe, ignoring");
            // Dupe
            return;
        }
        if (room.processedActivites.size === 0) {
            room.processedActivites.add(activity.id);
            return;
        }
        // if (Date.now() - Date.parse(activity.createdAt) > 600000) { // 10 minutes old
        //     // Comment was created at least 5 seconds before the webhook, ignore it.
        //     console.log("Activity is stale, ignoring");
        //     return;
        // }
        await room.handleNewActivity(activity);
    }

    public async startup() {    
        console.log(`${new Date().toUTCString()} Syncing rooms...`);
        await this.syncRooms();
        this.myUserId = await this.matrixClient.getUserId();

        // Get config from admin room.
        while(this.globalState === undefined) {
            try {
                await this.matrixClient.joinRoom(config.adminRoom);
                this.permittedMembers = new Set(await this.matrixClient.getJoinedRoomMembers(config.adminRoom));
                this.globalState = await this.matrixClient.getRoomStateEvent(config.adminRoom, ChallengeRoomStateGlobalConfigEventType, ""); 
                console.log("Permitted admins:", this.permittedMembers);   
            } catch (ex) {
                console.error(`Could not start, waiting for ${ChallengeRoomStateGlobalConfigEventType} to be defined in ${config.adminRoom}. Waiting 5s`);
                await new Promise(res => setTimeout(res, 5000));
            } 
        }
    
        console.log("Starting matrix sync..");
        AutojoinUpgradedRoomsMixin.setupOnClient(this.matrixClient);
        await this.matrixClient.start();
        this.matrixClient.on("room.message", this.onRoomMessage.bind(this));
        this.matrixClient.on("room.event", this.onRoomEvent.bind(this));
        this.matrixClient.on("room.invite", this.onInvite.bind(this));
        for (const i in this.bridgeRooms) {
            await this.fetchActiviesLoop();
        }
        const activityLoop = setInterval(this.fetchActiviesLoop.bind(this), 30000);
        process.on("SIGTERM", () => {
            console.log("Got SIGTERM, stopping app")
            this.matrixClient.stop();
            clearInterval(activityLoop);
        });
    }
}

async function main() {
    const app = new ChallengerApp();
    await app.startup();
}

main().catch((ex) => {
    console.log("FATAL EXCEPTION", ex);
})