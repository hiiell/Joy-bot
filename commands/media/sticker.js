
const pino = require("pino");
const sharp = require("sharp");
const WebP = require("node-webpmux");
const { downloadMediaMessage } = require("baileys");

const PACK_ID = "com.joybot.stickers";
const PACK_NAME = "with joy, by hilal";
// const PACK_AUTHOR = "hilal";

const react = async (Joy, sender, msg, emoji) => {
    try {
        await Joy.sendMessage(sender, {
            react: {
                text: emoji,
                key: msg.key
            }
        });
    } catch (error) {
        console.error("Reaction error:", error);
    }
};

const addStickerMetadata = async (buffer) => {
    const metadata = Buffer.from(
        JSON.stringify({
            "sticker-pack-id": PACK_ID,
            "sticker-pack-name": PACK_NAME,
            // "sticker-pack-publisher": PACK_AUTHOR,
            emojis: []
        }),
        "utf8"
    );

    const header = Buffer.from([
        0x49, 0x49, 0x2a, 0x00,
        0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57,
        0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00,
        0x00, 0x00
    ]);

    header.writeUInt32LE(metadata.length, 14);

    const image = new WebP.Image();

    await image.load(buffer);

    image.exif = Buffer.concat([
        header,
        metadata
    ]);

    return await image.save(null);
};

module.exports = async (Joy, msg, reply) => {
    const sender = msg.key.remoteJid;

    try {
        const quoted =
            msg.message.extendedTextMessage?.contextInfo;

        let targetMessage = msg;
        let imageMessage = msg.message.imageMessage;

        if (!imageMessage && quoted?.quotedMessage) {
            let quotedMessage = quoted.quotedMessage;

            quotedMessage =
                quotedMessage.ephemeralMessage?.message ||
                quotedMessage.viewOnceMessage?.message ||
                quotedMessage.viewOnceMessageV2?.message ||
                quotedMessage;

            imageMessage = quotedMessage.imageMessage;

            if (imageMessage) {
                targetMessage = {
                    key: {
                        remoteJid: sender,
                        id: quoted.stanzaId,
                        participant: quoted.participant
                    },
                    message: quotedMessage
                };
            }
        }

        if (!imageMessage) {
            return reply(
                "*Kirim gambar dengan caption .sticker atau balas gambar dengan .sticker*"
            );
        }

        await react(Joy, sender, msg, "⏳");

        const buffer = await downloadMediaMessage(
            targetMessage,
            "buffer",
            {},
            {
                logger: pino({ level: "silent" }),
                reuploadRequest: Joy.updateMediaMessage
            }
        );

        const webpBuffer = await sharp(buffer)
            .rotate()
            .resize(512, 512, {
                fit: "contain",
                background: {
                    r: 0,
                    g: 0,
                    b: 0,
                    alpha: 0
                }
            })
            .webp({ quality: 80 })
            .toBuffer();

        const stickerBuffer =
            await addStickerMetadata(webpBuffer);

        await Joy.sendMessage(
            sender,
            {
                sticker: stickerBuffer
            },
            {
                quoted: msg
            }
        );

        await react(Joy, sender, msg, "");

    } catch (error) {
        console.error("Sticker error:", error);
        await react(Joy, sender, msg, "❌");
    }
};
