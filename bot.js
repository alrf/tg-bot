const { Telegraf } = require('telegraf');
const fs = require('fs');
require('dotenv').config();
const https = require('https');
const InMemoryCache = require('./inmemorycache');
const cache = new InMemoryCache({ defaultTtl: '96h', cleanupInterval: '10min' });


if (!process.env.BOT_TOKEN) throw new Error('"BOT_TOKEN" env var is required!');
if (!process.env.CHAT_ID) throw new Error('"CHAT_ID" env var is required!');
if (!process.env.ADMIN_IDS) throw new Error('"ADMIN_IDS" env var is required!');


let bannedUsers;
const botToken = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID; // id of your group/channel
const adminUsers = process.env.ADMIN_IDS;
const bot = new Telegraf(botToken);


function getDT(style = 'medium', date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: style,
    timeStyle: style,
    timeZone: 'Europe/Vienna',
  }).format(date);
}


function makeRequest(options = '') {
  if (!options) {
    return false;
  }

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = [];

      res.on('data', chunk => {
        data.push(chunk);
      });

      res.on('end', () => { // Response ended
        // if (res.statusCode != 200) {
        //   console.log('statusCode:', res.statusCode);
        //   console.log('headers:', res.headers);
        // }
        resolve({ "statusCode": res.statusCode, "data": Buffer.concat(data).toString() });
      });
    });

    req.on('error', (e) => {
      console.error(e);
      resolve({ "statusCode": 500, "data": e });
    });

    req.end();
  });
}


function tgSendMessage(text = '') {
  if (!text) {
    return false;
  }

  text = encodeURIComponent(text);

  const options = {
    hostname: 'api.telegram.org',
    protocol: 'https:',
    port: 443,
    path: `/bot${botToken}/sendMessage?chat_id=${chatId}&parse_mode=html&disable_web_page_preview=true&text=${text}`,
    method: 'GET',
  };

  // console.log(options);

  makeRequest(options);
  // makeRequest(options)
  // .then(r => {
  //   console.log(r.statusCode);
  // })
}


function tgBanChatMember(user_id = 0) {
  if (user_id == 0) {
    return false;
  }

  const options = {
    hostname: 'api.telegram.org',
    protocol: 'https:',
    port: 443,
    path: `/bot${botToken}/banChatMember?chat_id=${chatId}&user_id=${user_id}`,
    method: 'GET',
  };

  // console.log(options);

  // makeRequest(options);
  makeRequest(options)
  .then(r => {
    console.log(r.statusCode, r.data);
  });
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

        // // Notify group about Scammer:
        // // Send the message ONLY if user left the group (i.e. either bot kicked him out, or if user left the group himself).
        // // If the user is in the cache (at the time of adding there he was fluffy bunny, not a scammer) and sends a message
        // // ALREADY being a scammer - the bot will kick him out (i.e. again 'left' group).
        // if (userScammer && userStatus == 'left') {
        //   const postid = userScamRsAlert ? `https://t.me/scamrsalert/${userScamRsAlert}` : '';
        //   const header = userScamRsAlert ? '<b>Внимание, мошенник!</b>' : '<b>Внимание, <i>возможно</i> мошенник!</b>';
        //   ctx.telegram.sendMessage(chatId, `${header}\n\nИнформация:\nhttps://t.me/lolsbotcatcherbot?start=${userId}\n${postid}`, { parse_mode: "HTML", disable_web_page_preview: true });
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
              console.log('LolsBot, cacheGet:', getDT(), userId, cacheGet, cache.getTtl(userId));
              // Don't delete the user from the cache as it is needed for scam checking
              let obj = { "added": cacheGet.added, "when": userWhen, "scammer": userScammer, "spammer": userBanned };
              const success = cache.update(userId, obj);
              if (success) {
                console.log('LolsBot, cacheUpdate:', getDT(), userId, cache.get(userId), cache.getTtl(userId));
              }
              // const success = cache.delete(userId);
              // if (success) {
              //   console.log('LolsBot, cacheDelete:', getDT(), userId, cache.keys(), cache.get(userId), cache.getTtl(userId));
              // }
            }

          })
          .catch((error) => { // Promise rejected
            console.error(`LolsBot ban error: User:${userId} Banned:${userBanned} SpamFactor:${userSpamFactor} Scammer:${userScammer} Error:${JSON.stringify(error)}`);
          });
        }

        // User is not banned in Lols Anti Spam, add it to the cache for X hours
        if (userBanned === false) {
          // if (!cacheGet) { // If user is NOT in cache - add it
          //   let obj = { "added": getDT(), "when": "", "scammer": false, "spammer": false };
          //   const success = cache.set(userId, obj);
          //   if (!success) {
          //     console.log('Cache issue', getDT(), userId, cache.keys(), cache.get(userId));
          //   }
          // }
          if (cacheGet) { // User in cache
            if (userStatus == 'left') { // Clear the cache on user left
              const success = cache.delete(userId);
              if (success) {
                console.log('LolsBot, cacheDelete1:', getDT(), userId, cache.keys(), cache.get(userId), cache.getTtl(userId));
              }
            }
          } else { // If user is NOT in cache - add it
            let obj = { "added": getDT(), "when": "", "scammer": false, "spammer": false };
            const success = cache.set(userId, obj);
            if (!success) {
              console.log('Cache issue', getDT(), userId, cache.keys(), cache.get(userId));
            }
          }
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
          ctx.reply(`User ${userId} has been banned.`);
          // console.log(chatId, result, bannedUsers);
          if (cache.get(Number(userId))) {
            cache.delete(Number(userId));
            console.log(`User ${userId} has been banned.`);
          }
        })
        .catch((error) => { // Promise rejected
          console.error(JSON.stringify(error));
          ctx.reply(`User ${userId} has not been banned.`);
        });

      } else {
        ctx.reply(`User ${userId} is already banned.`);
      }
    } else {
      ctx.reply("You are not allowed to ban users.");
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

      // const index = bannedUsers.indexOf(userId);
      // if (index > -1) {

        new Promise((resolve, reject) => {
          ctx.telegram.unbanChatMember(chatId, userId).then((result) => {
            resolve(result === true);
          })
          .catch((error) => {
            reject(error);
          });
        })
        .then((result) => { // Promise resolved
          // bannedUsers.splice(index, 1);
          // writeScamUsersId(bannedUsers);
          ctx.reply(`User ${userId} has been unbanned.`);
          // console.log(chatId, result, bannedUsers);
        })
        .catch((error) => { // Promise rejected
          console.error(JSON.stringify(error));
          ctx.reply(`User ${userId} has not been unbanned.`);
        });

      // } else {
      //   ctx.reply(`User ${userId} was not found in the Scam list.`);
      // }
    } else {
      ctx.reply("You are not allowed to unban users.");
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
      console.log("\n===========");
      console.log(getDT(), cache.getcache());
    } else {
      ctx.reply(`You are not allowed to use getcache.`);
    }
  })
  .catch((error) => {
    ctx.reply("Error: " + JSON.stringify(error));
  });
});


bot.command('getkeysadded', (ctx) => {
  isAdmin(ctx.message.from.id, ctx).then((result) => {
    if (result) {
      console.log("\n===========");
      console.log(getDT());
      const sortedEntries = Object.entries(JSON.parse(cache.getcache())).map(([key, { value }]) => ({ key, added: new Date(value.added) })).sort((a, b) => b.added - a.added);
      const resultString = sortedEntries.map(({ key, added }) => `${key}: ${getDT('medium', added)}`).join("\n");
      console.log(JSON.stringify(Object.fromEntries(sortedEntries.map(({ key, added }) => [key, getDT('medium', added)])), null, 2));
      ctx.reply(resultString.substring(0,4096));
    } else {
      ctx.reply(`You are not allowed to use getkeysadded.`);
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
    // console.log('Message, Get:', getDT(), userId, cache.keys(), value, cache.getTtl(userId));
    console.log('Message, Get:', getDT(), userId, value, cache.getTtl(userId));
    lolsBotCheck(userId, '', false, true, ctx);
  }
  // console.log("\n===========");
  // console.log('Message, cacheKeys:', getDT(), cache.keys());
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


function checkScammer() {
  setInterval(() => {

    const options = {
      hostname: 'lols.bot',
      protocol: 'https:',
      port: 443,
      path: '/scammers.json',
      method: 'GET',
    };

    makeRequest(options)
    .then(r => {
      fs.writeFileSync('/tmp/scammers.json', JSON.stringify(JSON.parse(r.data)));
      // console.log(r.statusCode);

      const cacheKeys = cache.keys();
      const targetUserIds = new Set(cacheKeys);
      let scammers = [];

      console.log("\n=========checkScammer=========");
      console.log(getDT(), `Cache size:${cacheKeys.length}`);

      try {
        scammers = JSON.parse(fs.readFileSync('/tmp/scammers.json', 'utf8'));
      } catch (e) {
        console.error(getDT(), 'Invalid JSON file!');
      }

      for (const scammer of scammers) {
        if (targetUserIds.has(scammer.user_id)) {
          const usernames = scammer.usernames.length ? `<b>Username</b>: ${scammer.usernames.join(', ')}\n` : '';
          const postid = scammer.postid ? `Информация:\nhttps://t.me/scamrsalert/${scammer.postid}` : '';
          // const header = scammer.postid ? '<b>Внимание, мошенник!</b>' : '<b>Внимание, <i>возможно</i> мошенник!</b>';
          const header = '<b>Внимание, мошенник!</b>';
          // const text = `${header}\n\n<b>Name</b>: ${scammer.names.join(', ')}\n${usernames}\nИнформация:\nhttps://t.me/lolsbotcatcherbot?start=${scammer.user_id}\n${postid}`;
          const text = `${header}\n\n<b>Name</b>: ${scammer.names.join(', ')}\n${usernames}\n${postid}`;
          tgSendMessage(text);
          console.log(scammer);
          cache.delete(Number(scammer.user_id));
          tgBanChatMember(scammer.user_id);
        }
      }
    });

  }, 7 * 60 * 1000); // 7 minutes in ms
  // }, 10000);
}


const startBot = async () => {
  const userCache = JSON.parse(fs.readFileSync('cache.json', 'utf8'));
  for(const userId in userCache){
    cache.set(Number(userId), { "added": userCache[userId], "when": "", "scammer": false, "spammer": false });
  }
  console.log(getDT(), cache.keys());

  // Notify group about Scammer
  checkScammer();

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
