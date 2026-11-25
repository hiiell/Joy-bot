
const pino = require("pino");
const sharp = require("sharp");
const { Sticker } = require("wa-sticker-formatter");
const { downloadMediaMessage } = require("baileys");

const STICKER_PACK = "JOYBOT";
const STICKER_AUTHOR = "Hilal";

module.exports = async (Joy, msg, reply) => {
    const sender = msg.key.remoteJid;

    const react = async (emoji) => {
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

    try {
        const quoted = msg.message.extendedTextMessage?.contextInfo;

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
                " *Kirim gambar dengan caption .sticker atau balas gambar dengan .sticker*"
            );
        }

        await react("⏳");

        const buffer = await downloadMediaMessage(
            targetMessage,
            "buffer",
            {},
            {
                logger: pino({ level: "silent" }),
                reuploadRequest: Joy.updateMediaMessage
            }
        );

        const imageBuffer = await sharp(buffer)
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

        const sticker = new Sticker(imageBuffer, {
            pack: STICKER_PACK,
            author: STICKER_AUTHOR,
            type: "full",
            quality: 80
        });

        const stickerBuffer = await sticker.toBuffer();

        await Joy.sendMessage(
            sender,
            { sticker: stickerBuffer },
            { quoted: msg }
        );

        await react("");

    } catch (error) {
        console.error("Sticker error:", error);
        await react("❌");
    }
};
