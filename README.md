# 🗃️ Archived

This project is now archived. https://github.com/matrix-org/matrix-hookshot now supports Challenge Hound and should be used instead.
After configuring Hookshot, you can invite the hookshot bot into existing rooms and it should pick up existing challenges.

----

# matrix-challenger
[![Docker Cloud Build Status](https://img.shields.io/docker/cloud/build/halfshot/matrix-challenger)](https://hub.docker.com/r/halfshot/matrix-challenger)

This bridge enables Matrix users to track [ChallengeHound](https://www.challengehound.com/) activities and groups.

## Setup

To set up the bridge, simply clone this repository.

`git clone git@github.com:Half-Shot/matrix-challenger.git`

then you will need to install dependencies

```bash
cd matrix-challenger
yarn
```

You will need:
    - An access token with rights to the group you want to bridge (pull from your brower)
    - A user account on Matrix for the bot.

The bridge is configured by environment variables. Ideally you should set these up in Docker,
but failing that you can use a bash script.

```env
export CHOUND_TOKEN=""
export MATRIX_HOMESERVER_URL=""
export MATRIX_ACCESS_TOKEN=""
```

Once you have these things, you should start the bridge (do it before you create the webhook).

`yarn start`

## Connecting rooms

Connecting rooms is as easy as inviting the bot to a room, giving it moderator permissions so it can modify state,
and sending `challenge track url`. The `url` is the full URL of the challenge. E.g.
`https://www.challengehound.com/challenge/abc-def-ghi`
