const { Telegraf } = require('telegraf');
const fs = require('fs');
require('dotenv').config();
const https = require('https');

const bot = new Telegraf(process.env.BOT_TOKEN);

if (!process.env.BOT_TOKEN) throw new Error('"BOT_TOKEN" env var is required!');
if (!process.env.CHAT_ID) throw new Error('"CHAT_ID" env var is required!');
if (!process.env.ADMIN_IDS) throw new Error('"ADMIN_IDS" env var is required!');

let bannedUsers;
const chatId = process.env.CHAT_ID; // id of your group/channel
const adminUsers = process.env.ADMIN_IDS;



function getDT() {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Europe/Vienna',
  }).format(new Date());
}


function isAdmin(IdOfUser, ctx) {
  return new Promise((resolve, reject) => {
    ctx.telegram.getChatMember(chatId, IdOfUser).then((user) => {
      if (!adminUsers.includes(IdOfUser)) {
        reject("You are not allowed to be here.");
      }
      // Check if user is admin (or creator)
      resolve(user.status == "administrator" || user.status == "creator");
    })
    .catch((error) => {
      reject(error);
    });
  });
}


function checkUserId(userId, ctx) {
  if (userId === undefined || !userId.match(/^\d{10}$/) || adminUsers.includes(userId)) {
    ctx.reply(`/${ctx.command} <Telegram ID> (a 10 digit number) must be used.`);
    return false;
  }
  return true;
}


function lolsBotCheck(userId, allowReply, allowBan, ctx) {
  https.get(`https://api.lols.bot/account?id=${userId}`, res => {
    let data = [];
    const headerDate = res.headers && res.headers.date ? res.headers.date : 'no response date';

    res.on('data', chunk => {
      data.push(chunk);
    });

    res.on('end', () => { // Response ended
      const user = JSON.parse(Buffer.concat(data).toString());

      if (res?.statusCode === 200 && user.ok === true) {

        const userBanned = user?.banned ?? false;
        const userSpamFactor = user?.spam_factor ?? 0;
        const userScammer = user?.scammer ?? false;

        // if (Math.round(userSpamFactor) < 70 && userScammer === false) { userBanned = false; }

        console.log(getDT(), userId, userBanned, userSpamFactor, userScammer);

        if (allowReply) {
          ctx.reply(`LolsBot check: User:${userId} Banned:${userBanned} SpamFactor:${userSpamFactor} Scammer:${userScammer}`);
        }

        if (allowBan === true && userBanned === true) { // Ban both Scammer & Spammer
          new Promise((resolve, reject) => {
            ctx.telegram.kickChatMember(chatId, userId).then((result) => {
              resolve(result === true);
            })
            .catch((error) => {
              reject(error);
            });
          })
          .then((result) => { // Promise resolved
            console.log(`LolsBot ban: Result:${result} User:${userId} Banned:${userBanned} SpamFactor:${userSpamFactor} Scammer:${userScammer}`);
          })
          .catch((error) => { // Promise rejected
            console.error(`LolsBot ban error: User:${userId} Banned:${userBanned} SpamFactor:${userSpamFactor} Scammer:${userScammer} Error:${JSON.stringify(error)}`);
          });
        }

      }
      else {
        console.error(`LolsBot error: User:${userId} StatusCode:${res.statusCode} Response:${JSON.stringify(user)}`);
      }

    });
  }).on('error', err => {
    console.error(`LolsBot error: ${err.message}`);
  });
}


function writeScamUsersId(bannedUsers) {
  try {
    fs.writeFileSync('spam-users-id.json', JSON.stringify(bannedUsers));
  } catch (error) {
    console.error("Can't write to the file " + error);
    return;
  }
}


try {
  bannedUsers = JSON.parse(fs.readFileSync('spam-users-id.json', 'utf8'));
} catch (error) {
  console.error(error);
  bannedUsers = [];
  // fs.writeFileSync('spam-users-id.json', JSON.stringify(bannedUsers));
}


bot.command('ban', (ctx) => {
  isAdmin(ctx.message.from.id, ctx).then((result) => {
    if (result) {
      const userId = ctx.args[0];
      if (!checkUserId(userId, ctx)) { return false; }

      if (!bannedUsers.includes(userId)) {

        new Promise((resolve, reject) => {
          ctx.telegram.kickChatMember(chatId, userId).then((result) => {
            resolve(result === true);
          })
          .catch((error) => {
            reject(error);
          });
        })
        .then((result) => { // Promise resolved
          bannedUsers.push(userId);
          writeScamUsersId(bannedUsers);
          ctx.reply(`User ${userId} has been banned and added to the Scam list.`);
          console.log(chatId, result, bannedUsers);
        })
        .catch((error) => { // Promise rejected
          console.error(JSON.stringify(error));
          ctx.reply(`User ${userId} has not been banned.`);
        });

      } else {
        ctx.reply(`User ${userId} is already in the Scam list.`);
      }
    } else {
      ctx.reply("You are not allowed to add users to the Scam list.");
    }
  })
  .catch((error) => {
    ctx.reply("Error: " + JSON.stringify(error));
  });
});


bot.command('unban', (ctx) => {
  isAdmin(ctx.message.from.id, ctx).then((result) => {
    if (result) {
      const userId = ctx.args[0];
      if (!checkUserId(userId, ctx)) { return false; }

      const index = bannedUsers.indexOf(userId);
      if (index > -1) {

        new Promise((resolve, reject) => {
          ctx.telegram.unbanChatMember(chatId, userId).then((result) => {
            resolve(result === true);
          })
          .catch((error) => {
            reject(error);
          });
        })
        .then((result) => { // Promise resolved
          bannedUsers.splice(index, 1);
          writeScamUsersId(bannedUsers);
          ctx.reply(`User ${userId} has been unbanned.`);
          console.log(chatId, result, bannedUsers);
        })
        .catch((error) => { // Promise rejected
          console.error(JSON.stringify(error));
          ctx.reply(`User ${userId} has not been unbanned.`);
        });

      } else {
        ctx.reply(`User ${userId} was not found in the Scam list.`);
      }
    } else {
      ctx.reply("You are not allowed to remove users from the Scam list.");
    }
  })
  .catch((error) => {
    ctx.reply("Error: " + JSON.stringify(error));
  });
});


bot.command('checkuser', (ctx) => {
  isAdmin(ctx.message.from.id, ctx).then((result) => {
    if (result) {
      const userId = ctx.args[0];
      if (!checkUserId(userId, ctx)) { return false; }

      lolsBotCheck(userId, true, false, ctx);
      
    } else {
      ctx.reply(`You are not allowed to use checkuser.`);
    }
  })
  .catch((error) => {
    ctx.reply("Error: " + JSON.stringify(error));
  });
});


bot.command('list', (ctx) => {
  isAdmin(ctx.message.from.id, ctx).then((result) => {
    if (result) {
      if (bannedUsers.length > 0) {
        ctx.reply(`List of Scam users: ${bannedUsers.join(', ')}`);
      } else {
        ctx.reply("List of Scam users is empty.");
      }
    } else {
      // ctx.reply(`You are not allowed to view the banned users list: ${ctx.message.chat.id}, ${ctx.message.from.id}`);
      ctx.reply(`You are not allowed to view the list of Scam users.`);
    }
  })
  .catch((error) => {
    ctx.reply("Error: " + JSON.stringify(error));
  });
});


bot.command('start', (ctx) => {
  isAdmin(ctx.message.from.id, ctx).then((result) => {
    if (result) {
      ctx.reply(`Use /list to view the list of Scam users.\n`);
    } else {
      ctx.reply(`You are not allowed to use this bot.`);
    }
  })
  .catch((error) => {
    ctx.reply("Error: " + JSON.stringify(error));
  });
});


bot.on("chat_member", (ctx) => {
  const chatMember = ctx.update?.chat_member;
  const userId = chatMember?.new_chat_member?.user?.id;
  const userName = chatMember?.new_chat_member?.user?.first_name;
  const userStatus = chatMember?.new_chat_member?.status;
  const userChatId = chatMember?.chat?.id;

  if (userStatus == 'member'){

    lolsBotCheck(userId, false, true, ctx);

    if (bannedUsers.includes(userId)) {
      ctx.telegram.kickChatMember(userChatId, userId);
      ctx.reply(`User:${userName} (Id:${userId}) has been banned and marked as Scam.`);
      console.log("\n===========");
      console.log(`User:${userName} (Id:${userId},Status:${userStatus}) has been banned and marked as Scam in the ${userChatId} chat.\nctx.message: ${JSON.stringify(chatMember)}`);
    } else{
      console.log("\n===========");
      console.log(`User:${userName} (Id:${userId},Status:${userStatus}) added to the ${userChatId} chat.\nctx.message: ${JSON.stringify(chatMember)}`);
    }

  }
});


bot.catch((err) => {
  console.log('Error: ', err)
});


const startBot = async () => {
  bot.launch({allowedUpdates: ['chat_member', 'message']})
    .then(() => {
      console.log("Bot Running");
    })
    .catch((err) => {
      console.log(`Error Running Bot: ${err}`);
    });
}

startBot();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
