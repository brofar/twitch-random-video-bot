// NEED TO RUN VIA TERMINAL.

const Store = require('node-persist');
const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const tmi = require('tmi.js');
const prompt = require('prompt');
const express = require('express');
const path = require('path');
const http = require('http');

const NONCE = '2345789hryunfidsjkl';
const PORT = 3000;

// WEBSERVER

var app = express();
var server = http.createServer(app);
var io = require('socket.io')(server);

// Routing
app.use('/static', express.static('videos'));

app.get('/', function (req, res) {
    res.sendFile('source.html', { root: '.' });
});

io.on('connection', function (socket) {
    socket.on('new_notification', function (data) {
        PlayRandomVideo();
    });
});

function SendNotification(videoFile) {
    io.sockets.emit('show_notification', {
        path: path.join('static', videoFile)
    });
}

// TWITCH PUBSUB
function ConnectPubSub() {
    pubSubConnection = new WebSocket('wss://pubsub-edge.twitch.tv');
    pubSubConnection.on('open', async () => {
        console.log('[STATUS]', 'PubSub socket open.');

        let token = await Store.getItem('token');
        let channelId = await Store.getItem('channelId');

        // connection is open and ready to use
        var msg = {
            "type": "LISTEN",
            "nonce": NONCE,
            "data": {
                "topics": ["channel-points-channel-v1." + channelId],
                "auth_token": token
            }
        };
        pubSubConnection.send(JSON.stringify(msg));
    });

    pubSubConnection.on('error', () => {
        console.warn('[STATUS]', 'PubSub socket error.');
    });

    pubSubConnection.on('close', () => {
        console.log('[STATUS]', 'PubSub socket closed. Reconnecting.');

        // Wait a sec and reconnect
        setTimeout(ConnectPubSub, 1000);
    });

    pubSubConnection.on('message', async (data) => {
        try {
            var event = JSON.parse(data);
        } catch (e) {
            console.warn(e);
            return;
        }

        switch (event.type) {
            case "RESPONSE": {
                if (event.error === 'ERR_BADAUTH') {
                    RefreshToken();
                    pubSubConnection.close();
                }
            } break;
            case "MESSAGE": {
                let message = JSON.parse(event.data.message);

                if (message.type == "reward-redeemed") {
                    let item = message.data.redemption.reward;

                    let rewardTitle = await Store.getItem('rewardTitle');

                    if (item.title == rewardTitle) {
                        PlayRandomVideo();
                    }
                }
            } break;
        }
    });
};

// TWITCH OAUTH

// Once our initial token is set, all we really need to do is continue to refresh it
// ...Except if the app ever stops, then we're kind of screwed.
async function RefreshToken() {
    let refresh = await Store.getItem('refreshToken');
    axios.get(`https://twitchtokengenerator.com/api/refresh/${refresh}`)
        .then(async (response) => {
            // handle success
            if (response.data.success == true) {
                console.log("API token refreshed successfully.");
                await Store.setItem('refreshToken', response.data.refresh);
                await Store.setItem('token', response.data.token);
            } else {
                throw "API token didn't refresh successfully.";
            }
        })
        .catch(async (error) => {
            // handle error
            console.warn('[TWITCH]', "API token not refreshed.");
            console.log(error);

            // Delete token so config prompts for it.
            await Store.removeItem('refreshToken');

            await FirstConfig();
        })
}

// APP

async function FirstConfig() {
    console.log('[STATUS]', "Running configuration.");

    let configs = [
        { name: 'refreshToken', desc: 'Go to https://twitchtokengenerator.com; generate a custom scope token with channel:read:redemptions toggled on; paste the REFRESH token here' },
        { name: 'channelId', desc: 'Go to https://decapi.me/twitch/id/{YOUR TWITCH USERNAME}; Paste your numeric channel ID here' },
        { name: 'rewardTitle', desc: 'The exact name of the channel redemption reward to listen for' }
    ];

    prompt.start();

    for (const config of configs) {
        let item = await Store.getItem(config.name);
        if (!item) {
            let result = await prompt.get([
                {
                    name: config.name,
                    required: true,
                    description: config.desc
                }
            ]);
            await Store.setItem(config.name, result[config.name]);
        }
    }

    return Promise.resolve();
}

function GetRandomFile() {
    var files = fs.readdirSync(path.join(__dirname, 'videos'));

    // now files is an Array of the name of the files in the folder and you can pick a random name inside of that array
    let chosenFile = files[Math.floor(Math.random() * files.length)];
    return chosenFile;
}

function PlayRandomVideo() {
    // PLAY VIDEO IN WEBPAGE
    let randomVideo = GetRandomFile();
    console.log('[REDEMPTION]', `Queueing file ${randomVideo}.`);
    SendNotification(randomVideo);
}

// RUN!
(async () => {
    const args = process.argv.slice(2);

    console.log('[STATUS]', 'Starting. Use argument --clear-settings to clear all your settings.');
    await Store.init();

    // Check for any command line arguments
    for (const arg of args) {
        if (arg == "--clear-settings") {
            console.log('[COMMAND]', `Clearing all settings.`);
            await Store.clear();
        }
    }

    await FirstConfig().then(() => {
        ConnectPubSub();
    
        server.listen(PORT, () => {
            console.log('[STATUS]', `Webserver started. Create a browser source that points to http://localhost:${PORT}.`);
        });
    })
})();