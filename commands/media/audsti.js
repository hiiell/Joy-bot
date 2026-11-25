
const PACK_NAME = "with joy, by hilal";
// const STICKER_AUTHOR = "hilal";
// 
const ffmpegPath = require("ffmpeg-static");
const pino = require("pino");
const {
    downloadMediaMessage
} = require("baileys");
const {
    execFile
} = require("child_process");
const {
    promisify
} = require("util");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const exec = promisify(execFile);

module.exports = async (Joy, msg, reply) => {
    const sender = msg.key.remoteJid;
    const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "joy-sound-")
    );

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
        const context =
            msg.message.extendedTextMessage?.contextInfo;

        let targetMessage = msg;
        let videoMessage = msg.message.videoMessage;

        if (!videoMessage && context?.quotedMessage) {
            let quoted = context.quotedMessage;

            quoted =
                quoted.ephemeralMessage?.message ||
                quoted.viewOnceMessage?.message ||
                quoted.viewOnceMessageV2?.message ||
                quoted;

            videoMessage = quoted.videoMessage;

            if (videoMessage) {
                targetMessage = {
                    key: {
                        remoteJid: sender,
                        id: context.stanzaId,
                        participant: context.participant
                    },
                    message: quoted
                };
            }
        }

        if (!videoMessage) {
            return reply(
                " Kirim atau balas video dengan command .soundsticker"
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

        const input = path.join(tempDir, "input.mp4");
        const video = path.join(tempDir, "sticker.webp");
        const audio = path.join(tempDir, "audio.ogg");

        await fs.writeFile(input, buffer);

        await exec(ffmpegPath, [
            "-y",
            "-i", input,
            "-t", "10",
            "-an",
            "-vf",
            "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
            "-c:v", "libwebp",
            "-loop", "0",
            "-quality", "60",
            video
        ]);

        await exec(ffmpegPath, [
            "-y",
            "-i", input,
            "-vn",
            "-t", "10",
            "-c:a", "libopus",
            "-b:a", "64k",
            "-ar", "48000",
            "-ac", "1",
            audio
        ]);

        const stickerBuffer = await fs.readFile(video);
        const audioBuffer = await fs.readFile(audio);

        await Joy.sendMessage(
            sender,
            {
                sticker: stickerBuffer,
                stickerAudio: audioBuffer,
                pack: PACK_NAME
                // author: STICKER_AUTHOR
            },
            { quoted: msg }
        );

        await react("");

    } catch (error) {
        console.error("Sound Sticker error:", error);
        await react("❌");

    } finally {
        await fs.rm(tempDir, {
            recursive: true,
            force: true
        });
    }
};
