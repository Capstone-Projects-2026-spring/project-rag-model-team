import {App} from '@slack/bolt';
import dotenv from 'dotenv';

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

const result = await app.client.conversations.list({
  token: process.env.SLACK_BOT_TOKEN
});

const channel = result.channels.find(c => c.name === "all-project-keystone");
const welcomeChannelId = channel.id;

app.message('hello', async ({ message, say }) => {
    console.log("User said hello");
  await say(`Hello, <@${message.user}>!`);
});

app.event('reaction_added', async ({ event, client, logger }) => {
    console.log("User added a reaction");
    await client.chat.postMessage({
        channel: event.item.channel,
        text: `You added a reaction: ${event.reaction}`
    });
});

app.event('team_join', async ({ event, client, logger }) => {
  try {
    // Call chat.postMessage with the built-in client
    const result = await client.chat.postMessage({
      channel: welcomeChannelId,
      text: `Welcome to the team, <@${event.user.id}>! If you get this message, put in the discord the phrase 'Cucumbers'.`
    });
    logger.info(result);
  }
  catch (error) {
    logger.error(error);
  }
});

(async () => {
    try {
    await app.client.chat.postMessage({
      channel: welcomeChannelId, // replace with your channel ID
      text: "Hello! I just started up!"
    });
    } catch (error) {
        console.error("Error sending startup message:", error);
    }
  await app.start(3000);
  console.log("⚡️ Slack bot is running!");
})();
