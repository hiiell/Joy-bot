const WebP = require("node-webpmux");

const PACK_ID = "com.joybot.stickers";
const PACK_NAME = "with joy, by hilal";
// const PACK_AUTHOR = "hilal";
// const PACK_EMOJIS = ["✨"];

async function addStickerMetadata(webpBuffer) {
    const metadata = {
        "sticker-pack-id": PACK_ID,
        "sticker-pack-name": PACK_NAME,
        // "sticker-pack-publisher": PACK_AUTHOR,
        // emojis: PACK_EMOJIS
    };

    const jsonBuffer = Buffer.from(
        JSON.stringify(metadata),
        "utf8"
    );

    const exifHeader = Buffer.from([
        0x49, 0x49, 0x2A, 0x00,
        0x08, 0x00, 0x00, 0x00,
        0x01, 0x00,
        0x41, 0x57,
        0x07, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x16, 0x00, 0x00, 0x00
    ]);

    const exif = Buffer.concat([
        exifHeader,
        jsonBuffer
    ]);

    exif.writeUIntLE(jsonBuffer.length, 14, 4);

    const image = new WebP.Image();

    await image.load(webpBuffer);
    image.exif = exif;

    return await image.save(null);
}


// Dependencies

const pino = require("pino");

const {
    downloadMediaMessage,
    normalizeMessageContent
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

const ffmpegPath = require("ffmpeg-static");

const exec = promisify(execFile);


// Error helper

function makeError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


// Main command

module.exports = async (Joy, msg, reply) => {
    const sender = msg.key.remoteJid;

    let tempDir;

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

        // Check FFmpeg
        if (!ffmpegPath) {
            throw new Error(
                "FFmpeg tidak ditemukan. Jalankan: npm install ffmpeg-static"
            );
        }

        // Check Sound Sticker support
        if (typeof Joy.sendSoundSticker !== "function") {
            throw new Error(
                "Fitur pengiriman Sound Sticker belum terpasang di index.js."
            );
        }

        // Normalize current message
        const currentContent =
            normalizeMessageContent(msg.message) ||
            msg.message;

        const context =
            currentContent.extendedTextMessage?.contextInfo ||
            msg.message.extendedTextMessage?.contextInfo;

        let targetMessage = {
            ...msg,
            message: currentContent
        };

        let videoMessage =
            currentContent.videoMessage;

        // Support replying to a video
        if (!videoMessage && context?.quotedMessage) {
            const quotedContent =
                normalizeMessageContent(context.quotedMessage) ||
                context.quotedMessage;

            videoMessage = quotedContent.videoMessage;

            if (videoMessage) {
                targetMessage = {
                    key: {
                        remoteJid: sender,
                        id: context.stanzaId,
                        participant: context.participant
                    },
                    message: quotedContent
                };
            }
        }

        // Check video
        if (!videoMessage) {
            return reply(
                "Kirim video atau balas video dengan command .audis"
            );
        }

        await react("⏳");

        // Create temporary directory
        tempDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "joy-audis-")
        );

        // Download video
        const buffer = await downloadMediaMessage(
            targetMessage,
            "buffer",
            {},
            {
                logger: pino({
                    level: "silent"
                }),
                reuploadRequest: Joy.updateMediaMessage
            }
        );

        const input = path.join(
            tempDir,
            "input.mp4"
        );

        const video = path.join(
            tempDir,
            "sticker.webp"
        );

        const audio = path.join(
            tempDir,
            "audio.ogg"
        );

        await fs.writeFile(input, buffer);


        // Extract audio (maximum 5 seconds)

        try {
            await exec(ffmpegPath, [
                "-y",
                "-i", input,
                "-map", "0:a:0",
                "-vn",
                "-t", "5",
                "-c:a", "libopus",
                "-b:a", "64k",
                "-ar", "48000",
                "-ac", "1",
                "-application", "voip",
                "-f", "ogg",
                audio
            ]);

        } catch (error) {
            const stderr = String(
                error.stderr ||
                error.message ||
                ""
            );

            if (
                /matches no streams|does not contain any stream|Stream map.*matches no streams/i
                    .test(stderr)
            ) {
                throw makeError(
                    "Video tersebut tidak memiliki audio. Coba gunakan video yang memiliki suara.",
                    "NO_AUDIO_TRACK"
                );
            }

            throw error;
        }


        // Convert video to animated WebP (maximum 10 seconds)

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


        // Read generated files

        const rawStickerBuffer = await fs.readFile(video);
        const audioBuffer = await fs.readFile(audio);


        // Validate audio

        if (
            audioBuffer.length < 64 ||
            audioBuffer.subarray(0, 4).toString("ascii") !== "OggS"
        ) {
            throw new Error(
                "Audio gagal dikonversi."
            );
        }


        // Add sticker metadata

        const stickerBuffer = await addStickerMetadata(
            rawStickerBuffer
        );


        // Validate WebP

        if (
            stickerBuffer.length < 16 ||
            stickerBuffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
            stickerBuffer.subarray(8, 12).toString("ascii") !== "WEBP"
        ) {
            throw new Error(
                "Video gagal dikonversi."
            );
        }


        // Send Sound Sticker

        await Joy.sendSoundSticker(
            sender,
            stickerBuffer,
            audioBuffer,
            {
                quoted: msg
            }
        );

        await react("");


    } catch (error) {

        console.error("Audis error:", error);

        await react("❌");

        if (error.code === "NO_AUDIO_TRACK") {
            await reply(error.message);
        } else {
            await reply(
                "Gagal membuat Sound Sticker."
            );
        }

    } finally {

        // Cleanup temporary files

        if (tempDir) {
            await fs.rm(tempDir, {
                recursive: true,
                force: true
            }).catch((error) => {
                console.error(
                    "Temp cleanup error:",
                    error.message
                );
            });
        }
    }
};