const say = require("./say");
const botrestart = require("./botrestart");
const debug = require("./debug");
const ping = require("./ping");
const uptime = require("./uptime");
const jid = require("./jid");
const dlmsg = require("./dlmsg");
const aaeiilnndraatt = require("./aaeiilnndraatt");

const commands = {
    say,
    botrestart,
    debug,
    ping,
    uptime,
    jid,
    dlmsg,
    aaeiilnndraatt
};

module.exports = async (
    Joy,
    msg,
    reply,
    args,
    command,
    options = {}
) => {
    if (!options.isAuthor) return;

    const handler = commands[command];

    if (!handler) return;

    return handler(
        Joy,
        msg,
        reply,
        args,
        command,
        options
    );
};