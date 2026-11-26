
const WebP = require("node-webpmux");

// Configuration

const PACK_ID = "com.joybot.stickers";
const PACK_NAME = "with joy, by @hihilalal_";

const MAX_DURATION = 60;


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
const { isIP } = require("net");

const ffmpegPath = require("ffmpeg-static");

const exec = promisify(execFile);


// Error helper

function makeError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


// Message text extractor

function getMessageText(content) {
    return (
        content?.conversation ||
        content?.extendedTextMessage?.text ||
        content?.videoMessage?.caption ||
        content?.imageMessage?.caption ||
        content?.documentMessage?.caption ||
        content?.documentWithCaptionMessage
            ?.message?.documentMessage?.caption ||
        ""
    ).trim();
}


// Parse .audis arguments

function parseAudisArguments(text) {
    const body = String(text || "")
        .trim()
        .replace(/^\.audis(?:@\S+)?\s*/i, "")
        .trim();

    const urlMatch = body.match(
        /https?:\/\/[^\s<>"']+/i
    );

    let url = null;
    let lengthToken = null;

    if (urlMatch) {
        url = urlMatch[0].replace(/[),.;!?]+$/, "");

        const remaining = body
            .slice(urlMatch.index + urlMatch[0].length)
            .trim();

        if (remaining) {
            lengthToken = remaining.split(/\s+/)[0];
        }

    } else {
        const tokens = body.split(/\s+/).filter(Boolean);

        if (tokens.length > 0) {
            lengthToken = tokens[tokens.length - 1];
        }
    }

    return {
        url,
        lengthToken
    };
}


// Basic private IP protection

function isPrivateIp(hostname) {
    const host = hostname.replace(/^\[|\]$/g, "");
    const version = isIP(host);

    if (version === 4) {
        const [a, b] = host.split(".").map(Number);

        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            a >= 224
        );
    }

    if (version === 6) {
        return (
            host === "::" ||
            host === "::1" ||
            /^(fc|fd|fe80|ff)/i.test(host) ||
            host.startsWith("::ffff:127.")
        );
    }

    return false;
}


// Validate media URL

function validateMediaUrl(rawUrl) {
    let parsed;

    try {
        parsed = new URL(rawUrl);
    } catch {
        throw makeError(
            "Link media tidak valid.",
            "INVALID_URL"
        );
    }

    if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
    ) {
        throw makeError(
            "Gunakan link media HTTP atau HTTPS yang valid.",
            "INVALID_URL"
        );
    }

    const hostname = parsed.hostname.toLowerCase();

    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        isPrivateIp(hostname)
    ) {
        throw makeError(
            "Alamat media tidak diizinkan.",
            "INVALID_URL"
        );
    }

    return parsed.href;
}


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


// Download video from URL using yt-dlp

async function downloadFromUrl(url, downloadDir) {
    let youtubedl;

    try {
        youtubedl = require("youtube-dl-exec");
    } catch {
        throw makeError(
            "Dependency youtube-dl-exec belum terpasang. Jalankan npm install youtube-dl-exec.",
            "YTDLP_MISSING"
        );
    }

    try {
        await youtubedl(url, {
            output: path.join(
                downloadDir,
                "source.%(ext)s"
            ),

            noPlaylist: true,
            noProgress: true,
            noWarnings: true,
            quiet: true,
            ignoreConfig: true,

            noWriteInfoJson: true,
            noWriteThumbnail: true,
            noWriteSubs: true,

            ffmpegLocation: ffmpegPath
        });

    } catch (error) {
        const downloadError = makeError(
            "URL gagal diunduh.",
            "URL_DOWNLOAD_FAILED"
        );

        downloadError.stderr = error.stderr;
        throw downloadError;
    }

    const entries = await fs.readdir(
        downloadDir,
        { withFileTypes: true }
    );

    const candidates = entries.filter(entry => {
        return (
            entry.isFile() &&
            entry.name.startsWith("source.") &&
            !/\.(part|ytdl|json)$/i.test(entry.name)
        );
    });

    if (candidates.length === 0) {
        throw makeError(
            "Tidak ditemukan video dari link tersebut.",
            "URL_DOWNLOAD_FAILED"
        );
    }

    const downloadedFile = path.join(
        downloadDir,
        candidates[0].name
    );

    const stat = await fs.stat(downloadedFile);

    if (stat.size === 0) {
        throw makeError(
            "File hasil download kosong.",
            "URL_DOWNLOAD_FAILED"
        );
    }

    return downloadedFile;
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
                "FFmpeg tidak ditemukan."
            );
        }

        // Check Sound Sticker support

        if (typeof Joy.sendSoundSticker !== "function") {
            throw new Error(
                "Sound Sticker belum terpasang di index.js."
            );
        }


        // Normalize current message

        const currentContent =
            normalizeMessageContent(msg.message) ||
            msg.message;

        // Parse command arguments

        const rawText =
            getMessageText(currentContent) ||
            msg.text ||
            msg.body ||
            "";

        const args = parseAudisArguments(rawText);


        // Set default duration

        let requestedDuration = MAX_DURATION;

        if (args.lengthToken !== null) {

            if (!/^\d+$/.test(args.lengthToken)) {
                return reply(
                    "Length harus berupa angka bulat dalam satuan detik."
                );
            }

            requestedDuration = Number(
                args.lengthToken
            );

            // Maximum duration validation

            if (requestedDuration > MAX_DURATION) {
                return reply(
                    `Maksimal durasi Sound Sticker adalah ${MAX_DURATION} detik.`
                );
            }

            if (requestedDuration < 1) {
                return reply(
                    "Minimal durasi Sound Sticker adalah 1 detik."
                );
            }
        }


        // Validate URL if provided

        const mediaUrl = args.url
            ? validateMediaUrl(args.url)
            : null;


        // Get current or quoted video

        const context =
            currentContent.extendedTextMessage?.contextInfo ||
            currentContent.imageMessage?.contextInfo ||
            currentContent.videoMessage?.contextInfo;

        let targetMessage = {
            ...msg,
            message: currentContent
        };

        let videoMessage =
            currentContent.videoMessage;

        // Support replying to a video

        if (!videoMessage && context?.quotedMessage) {
            const quotedContent =
                normalizeMessageContent(
                    context.quotedMessage
                ) || context.quotedMessage;

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


        // Check input source

        if (!mediaUrl && !videoMessage) {
            return reply(
                "Kirim video, balas video dengan .audis, atau gunakan:\n\n" +
                ".audis <link> [length]\n\n" +
                "Contoh:\n" +
                ".audis https://tiktok.com/... 15\n" +
                ".audis https://tiktok.com/...\n\n" +
                "Length default: 60 detik."
            );
        }


        await react("⏳");


        // Create temporary directory

        tempDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "joy-audis-")
        );


        // Input path

        let input;


        // MODE 1: Download from URL

        if (mediaUrl) {

            const downloadDir = path.join(
                tempDir,
                "download"
            );

            await fs.mkdir(downloadDir, {
                recursive: true
            });

            input = await downloadFromUrl(
                mediaUrl,
                downloadDir
            );

        }


        // MODE 2: Download WhatsApp media

        else {

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

            input = path.join(
                tempDir,
                "input.mp4"
            );

            await fs.writeFile(input, buffer);
        }


        // Output paths

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


        // STEP 1: Trim video to requested duration

        await exec(ffmpegPath, [
            "-y",
            "-i", input,

            "-t", String(requestedDuration),

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


        // STEP 2: Extract audio

        try {
            await exec(ffmpegPath, [
                "-y",
                "-i", trimmed,

                "-map", "0:a:0",
                "-vn",

                "-t", String(requestedDuration),

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


        // STEP 3: Convert video to animated WebP

        await exec(ffmpegPath, [
            "-y",
            "-i", trimmed,

            "-t", String(requestedDuration),

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


        // STEP 5: Add metadata

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

        switch (error.code) {

            case "NO_AUDIO_TRACK":
                await reply(error.message);
                break;

            case "YTDLP_MISSING":
                await reply(error.message);
                break;

            case "INVALID_URL":
                await reply(error.message);
                break;

            case "URL_DOWNLOAD_FAILED":
                await reply(
                    "Gagal mengunduh media dari link tersebut. Pastikan link dapat diakses dan situsnya didukung."
                );
                break;

            default:
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
            }).catch(error => {
                console.error(
                    "Temp cleanup error:",
                    error.message
                );
            });
        }
    }
};
