const { Telegraf } = require('telegraf');
const fs = require('fs');
require('dotenv').config();
const https = require('https');
const InMemoryCache = require('./inmemorycache');
const cache = new InMemoryCache({ defaultTtl: '60h', cleanupInterval: '10min' });


if (!process.env.BOT_TOKEN) throw new Error('"BOT_TOKEN" env var is required!');
if (!process.env.CHAT_ID) throw new Error('"CHAT_ID" env var is required!');
if (!process.env.ADMIN_IDS) throw new Error('"ADMIN_IDS" env var is required!');


let bannedUsers;
const bot = new Telegraf(process.env.BOT_TOKEN);
const chatId = process.env.CHAT_ID; // id of your group/channel
const adminUsers = process.env.ADMIN_IDS;


function getDT(style = 'medium') {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: style,
    timeStyle: style,
    timeZone: 'Europe/Vienna',
  }).format(new Date());
}


function isAdmin(IdOfUser, ctx) {
  return new Promise((resolve, reject) => {
    ctx.telegram.getChatMember(chatId, IdOfUser).then((user) => {
      if (!adminUsers.includes(IdOfUser)) {
        console.log("\n===========");
        console.log('Not Admin user:', getDT(), IdOfUser);
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


function lolsBotCheck(userId, userStatus = '', allowReply = false, allowBan = false, ctx) {
  https.get(`https://api.lols.bot/account?id=${userId}`, res => {
    let data = [];

    res.on('data', chunk => {
      data.push(chunk);
    });

    res.on('end', () => { // Response ended
      const user = JSON.parse(Buffer.concat(data).toString());

      if (res?.statusCode === 200 && user.ok === true) {

        userId = user?.user_id ?? 0; // always get as number
        const userBanned = user?.banned ?? false;
        const userSpamFactor = user?.spam_factor ?? 0;
        const userScammer = user?.scammer ?? false;
        const userScamRsAlert = user?.scamrsalert ?? 0;
        const userWhen = user?.when ?? '';
        const cacheGet = cache.get(userId);

        // if (Math.round(userSpamFactor) < 70 && userScammer === false) { userBanned = false; }

        console.log(getDT(), userId, userBanned, userSpamFactor, userScammer);

        if (allowReply) {
          ctx.reply(`LolsBot check: User:${userId} Banned:${userBanned} SpamFactor:${userSpamFactor} Scammer:${userScammer}`);
        }

        // Notify group about Scammer:
        // Send the message ONLY if user left the group (i.e. either bot kicked him out, or if user left the group himself).
        // If the user is in the cache (at the time of adding there he was fluffy bunny, not a scammer) and sends a message
        // ALREADY being a scammer - the bot will kick him out (i.e. again 'left' group).
        if (userScammer && userStatus == 'left') {
          ctx.telegram.sendMessage(chatId, `<b>Внимание, мошенник!</b>\nTelegram ID:${userId}\n\nИнформация:\nhttps://t.me/lolsbotcatcherbot?start=${userId}\nhttps://t.me/scamrsalert/${userScamRsAlert}`, { parse_mode: "HTML", disable_web_page_preview: true });
        }
        // if (userScammer && userStatus == 'left') {
        //   const from = ctx.update?.message?.from ?? ctx.update?.chat_member?.from;
        //   const fromId = from.id ?? '';
        //   let fromFirstName = from.first_name ?? '';
        //   const fromUsername = from.username ?? '';
        //   if (fromUsername) {
        //     fromFirstName = `${fromFirstName}\n@${fromUsername}`;
        //   }
        //   ctx.telegram.sendMessage(chatId, `<b>Внимание, мошенник!</b>\n${fromFirstName}\n\nИнформация:\nhttps://t.me/lolsbotcatcherbot?start=${fromId}\nhttps://t.me/scamrsalert/${userScamRsAlert}`, { parse_mode: "HTML", disable_web_page_preview: true });
        // }

        // Ban both Scammer & Spammer right away
        if (allowBan === true && userBanned === true) {
          new Promise((resolve, reject) => {
            ctx.telegram.kickChatMember(chatId, userId)
            .then((result) => {
              resolve(result === true);
            })
            .catch((error) => {
              reject(error);
            });
          })
          .then((result) => { // Promise resolved
            console.log(`LolsBot ban: Result:${result} User:${userId} Banned:${userBanned} SpamFactor:${userSpamFactor} Scammer:${userScammer}`);

            // If user is in cache - update it
            if (cacheGet) {
              console.log('LolsBot, cacheGet:', getDT(), userId, cache.keys(), cacheGet, cache.getTtl(userId));
              let obj = { "added": cacheGet.added, "when": userWhen, "scammer": userScammer, "spammer": userBanned };
              success = cache.update(userId, obj);
              if (success) {
                console.log('LolsBot, cacheSet:', getDT(), userId, cache.keys(), cache.get(userId), cache.getTtl(userId));
              }
              // console.log('LolsBot, cacheKeys1:', getDT(), cache.keys());
            }

          })
          .catch((error) => { // Promise rejected
            console.error(`LolsBot ban error: User:${userId} Banned:${userBanned} SpamFactor:${userSpamFactor} Scammer:${userScammer} Error:${JSON.stringify(error)}`);
          });
        }

        // User is not banned in Lols Anti Spam, add it to the cache for X hours
        if (userBanned === false) {
          if (!cacheGet) { // If user is NOT in cache - add it
            let obj = { "added": getDT('long'), "when": "", "scammer": false, "spammer": false };
            success = cache.set(userId, obj);
            if (!success) {
              console.log('Cache issue', getDT(), userId, cache.keys(), cache.get(userId));
            }
          }
          // console.log('LolsBot, cacheKeys2:', getDT(), cache.keys());
          // Otherwise doing nothing (user cache will be cleared automatically)
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

      lolsBotCheck(userId, '', true, false, ctx);
      
    } else {
      ctx.reply(`You are not allowed to use checkuser.`);
    }
  })
  .catch((error) => {
    ctx.reply("Error: " + JSON.stringify(error));
  });
});


bot.command('cachekeys', (ctx) => {
  isAdmin(ctx.message.from.id, ctx).then((result) => {
    if (result) {
      ctx.reply(`Keys: ${cache.keys().toString()}`);
      console.log("\n===========");
      console.log(getDT(), cache.keys());
    } else {
      ctx.reply(`You are not allowed to use cachekeys.`);
    }
  })
  .catch((error) => {
    ctx.reply("Error: " + JSON.stringify(error));
  });
});


bot.command('cachevalues', (ctx) => {
  isAdmin(ctx.message.from.id, ctx).then((result) => {
    if (result) {
      ctx.reply(`Values: ${JSON.stringify(cache.values())}`);
    } else {
      ctx.reply(`You are not allowed to use cachevalues.`);
    }
  })
  .catch((error) => {
    ctx.reply("Error: " + JSON.stringify(error));
  });
});


bot.command('getcache', (ctx) => {
  isAdmin(ctx.message.from.id, ctx).then((result) => {
    if (result) {
      ctx.reply(`Cache: ${cache.getcache()}`.substring(0,4096));
    } else {
      ctx.reply(`You are not allowed to use getcache.`);
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


bot.on('message', (ctx) => {
  if (ctx.message.left_chat_member || ctx.message.new_chat_member) { return false; }

  const userId = ctx.message.from.id;

  value = cache.get(userId);
  if (value){ // there's a value in the cache for the user (i.e. it was recently added to the cache)
    if (value.scammer === true || value.spammer === true) { // the user has already been processed
      return false;
    }
    console.log('Message, Get:', getDT(), userId, cache.keys(), value, cache.getTtl(userId));
    lolsBotCheck(userId, '', false, true, ctx);
  }
  console.log("\n===========");
  console.log('Message, cacheKeys:', getDT(), cache.keys());
});


bot.on("chat_member", (ctx) => {
  const chatMember = ctx.update?.chat_member;
  const userId = chatMember?.new_chat_member?.user?.id;
  const userFirstName = chatMember?.new_chat_member?.user?.first_name;
  const userUsername = chatMember?.new_chat_member?.user?.username ?? 'Unknown';
  const userStatus = (chatMember?.new_chat_member?.status == 'member') ? 'joined' : 'left';

  console.log("\n===========");
  console.log(`User:${userFirstName} (Id:${userId},Username:${userUsername},Status:${userStatus}) ${userStatus} the ${chatId} chat.\nctx.message: ${JSON.stringify(chatMember)}`);

  lolsBotCheck(userId, userStatus, false, true, ctx);

  if (bannedUsers.includes(userId)) {
    ctx.telegram.kickChatMember(chatId, userId);
    ctx.reply(`User:${userFirstName} (Id:${userId},Username:${userUsername}) has been banned and marked as Scam.`);
    console.log("\n===========");
    console.log(`User:${userFirstName} (Id:${userId},Username:${userUsername},Status:${userStatus}) has been banned and marked as Scam in the ${chatId} chat.\nctx.message: ${JSON.stringify(chatMember)}`);
  }
});


bot.catch((err) => {
  console.log('Error: ', err)
});


const startBot = async () => {
  const userCache = fs.readFileSync('cache.txt', 'utf8').replace(/[\r\n\s]+/gm, "").split(',');
  for (userId of userCache) {
    cache.set(Number(userId), { "added": getDT('long'), "when": "", "scammer": false, "spammer": false });
  }
  console.log(getDT(), cache.keys());

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
