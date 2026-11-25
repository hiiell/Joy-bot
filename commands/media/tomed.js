const pino = require("pino");
const sharp = require("sharp");
const { downloadMediaMessage } = require("baileys");

module.exports = async (Joy, msg, reply) => {
    const sender = msg.key.remoteJid;

    // Reaction helper
    const react = async (emoji) => {
        try {
            await Joy.sendMessage(sender, {
                react: {
                    text: emoji,
                    key: msg.key
                }
            });
        } catch (error) {
            console.error(
                "Reaction error:",
                error.message
            );
        }
    };

    try {
        const quoted = msg.message.extendedTextMessage?.contextInfo;

        let stickerMessage = msg.message.stickerMessage;
        let targetMessage = msg;

        if (!stickerMessage && quoted?.quotedMessage) {
            let quotedMessage = quoted.quotedMessage;

            quotedMessage =
                quotedMessage.ephemeralMessage?.message ||
                quotedMessage.viewOnceMessage?.message ||
                quotedMessage.viewOnceMessageV2?.message ||
                quotedMessage;

            stickerMessage = quotedMessage.stickerMessage;

            if (stickerMessage) {
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

        if (!stickerMessage) {
            return reply("*Balas sticker dengan .tomed*");
        }

        // Start processing
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

        const isAnimated = stickerMessage.isAnimated;

        if (isAnimated) {
            const gifBuffer = await sharp(buffer, {
                animated: true
            })
                .gif()
                .toBuffer();

            await Joy.sendMessage(
                sender,
                {
                    video: gifBuffer,
                    gifPlayback: true,
                    caption: "*iya, sama sama*"
                },
                { quoted: msg }
            );

        } else {
            const imageBuffer = await sharp(buffer)
                .png()
                .toBuffer();

            await Joy.sendMessage(
                sender,
                {
                    image: imageBuffer,
                    caption: "*iya, sama sama*"
                },
                { quoted: msg }
            );
        }

        // Processing completed
        await react("");

    } catch (error) {
        console.error("Error To Media:", error);

        // Processing failed
        await react("❌");

        await reply(
            "⚠️ *Gagal mengubah sticker. Pastikan kamu membalas sticker yang valid.*"
        );
    }
};