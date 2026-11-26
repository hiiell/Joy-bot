
const WebP = require("node-webpmux");

const PACK_ID = "com.joybot.stickers";
const PACK_NAME = "with joy, by hilal";

const MAX_DURATION = 30;

// Sticker metadata

async function addStickerMetadata(webpBuffer) {
    const metadata = {
        "sticker-pack-id": PACK_ID,
        "sticker-pack-name": PACK_NAME
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
                "Fitur Sound Sticker belum terpasang di index.js."
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

        // File paths

        const input = path.join(
            tempDir,
            "input.mp4"
        );

        const trimmed = path.join(
            tempDir,
            "trimmed.mp4"
        );

        const video = path.join(
            tempDir,
            "sticker.webp"
        );

        const audio = path.join(
            tempDir,
            "audio.ogg"
        );

        // Download original video

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

        await fs.writeFile(input, buffer);


        // STEP 1: Trim video to maximum 30 seconds

        await exec(ffmpegPath, [
            "-y",
            "-i", input,

            "-t", String(MAX_DURATION),

            "-map", "0:v:0",
            "-map", "0:a:0?",

            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "20",
            "-pix_fmt", "yuv420p",

            "-c:a", "aac",
            "-b:a", "128k",

            "-movflags", "+faststart",

            trimmed
        ]);

        
        // STEP 2: Extract audio from trimmed video

        try {
            await exec(ffmpegPath, [
                "-y",
                "-i", trimmed,

                "-map", "0:a:0",
                "-vn",

                "-t", String(MAX_DURATION),

                "-c:a", "libopus",
                "-b:a", "48k",
                "-ar", "48000",
                "-ac", "1",
                "-application", "voip",

                "-avoid_negative_ts", "make_zero",
                "-map_metadata", "-1",

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


        // STEP 3: Convert trimmed video to animated WebP

        await exec(ffmpegPath, [
            "-y",
            "-i", trimmed,

            "-t", String(MAX_DURATION),

            "-an",

            "-vf",
            "fps=15,scale=512:512:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",

            "-c:v", "libwebp",
            "-loop", "0",
            "-quality", "60",

            video
        ]);


        // STEP 4: Read generated files

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


        // STEP 5: Add sticker metadata

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


        // STEP 6: Send Sound Sticker

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
