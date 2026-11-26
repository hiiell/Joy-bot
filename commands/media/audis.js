
const axios = require("axios");
const WebP = require("node-webpmux");

// Configuration

const PACK_ID = "com.joybot.stickers";
const PACK_NAME = "with joy, by @hihilalal_";

const MAX_DURATION = 60;
const MAX_STICKER_DURATION = 10;
const MAX_WEBP_SIZE = 480 * 1024;
const MAX_DOWNLOAD_SIZE = 80 * 1024 * 1024;

const TIKTOK_API =
    "https://ikhlasapi.web.id/api/downloader/tiktok-v2";


// Dependencies

const pino = require("pino");

const {
    downloadMediaMessage,
    normalizeMessageContent
} = require("baileys");

const { execFile } = require("child_process");
const { promisify } = require("util");

const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const os = require("os");
const { isIP } = require("net");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");

const ffmpegPath = require("ffmpeg-static");
const exec = promisify(execFile);


// Error helper

function makeError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


// FFmpeg helper

async function runFFmpeg(args) {
    return exec(ffmpegPath, [
        "-hide_banner",
        "-loglevel", "error",
        ...args
    ], {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
    });
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


// Private IP protection

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


// Validate TikTok URL

function validateTikTokUrl(rawUrl) {
    let parsed;

    try {
        parsed = new URL(rawUrl);
    } catch {
        throw makeError(
            "Link tidak valid.",
            "INVALID_URL"
        );
    }

    if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
    ) {
        throw makeError(
            "Link tidak valid.",
            "INVALID_URL"
        );
    }

    const hostname = parsed.hostname.toLowerCase();

    const isTikTokHost =
        hostname === "tiktok.com" ||
        hostname.endsWith(".tiktok.com");

    if (!isTikTokHost || isPrivateIp(hostname)) {
        throw makeError(
            "Link TikTok tidak valid.",
            "INVALID_URL"
        );
    }

    return parsed.href;
}


// Find video URL from TTDL API response

function findVideoUrl(data) {
    const candidates = [];

    function scan(value, keyPath = []) {
        if (typeof value === "string") {
            if (!/^https?:\/\//i.test(value)) return;

            const key = keyPath
                .join(".")
                .toLowerCase();

            if (
                /audio|music|cover|avatar|image|photo|thumbnail/.test(key)
            ) {
                return;
            }

            let score = 0;

            if (/nowm|no.?watermark|hdplay/.test(key)) score += 10;
            if (/video/.test(key)) score += 8;
            if (/play/.test(key)) score += 5;
            if (/download/.test(key)) score += 3;
            if (/\.mp4(?:[?#]|$)/i.test(value)) score += 4;

            if (score > 0) {
                candidates.push({
                    url: value,
                    score
                });
            }

            return;
        }

        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                scan(item, [...keyPath, String(index)]);
            });

            return;
        }

        if (value && typeof value === "object") {
            const isVideo = /video/i.test(
                String(
                    value.type ||
                    value.mimeType ||
                    value.mime_type ||
                    ""
                )
            );

            for (const [key, item] of Object.entries(value)) {
                const nextPath = isVideo
                    ? [...keyPath, "video", key]
                    : [...keyPath, key];

                scan(item, nextPath);
            }
        }
    }

    scan(data);
    candidates.sort((a, b) => b.score - a.score);

    return candidates[0]?.url || null;
}


// Download TikTok video through TTDL

async function downloadTikTokVideo(url, outputPath) {
    let data;

    try {
        const response = await axios.get(
            TIKTOK_API,
            {
                params: { url },
                headers: {
                    Accept: "application/json"
                },
                timeout: 60000,
                maxContentLength: 5 * 1024 * 1024
            }
        );

        data = response.data;

    } catch (error) {
        console.error(
            "[AUDIS TTDL API]",
            error.message
        );

        throw makeError(
            "Gagal mengambil data TikTok.",
            "URL_DOWNLOAD_FAILED"
        );
    }


    // Validate API response

    if (
        data?.status === false ||
        data?.success === false
    ) {
        throw makeError(
            "Video TikTok tidak tersedia.",
            "URL_DOWNLOAD_FAILED"
        );
    }


    // Find video URL

    const videoUrl = findVideoUrl(data);

    if (!videoUrl) {
        throw makeError(
            "Video TikTok tidak ditemukan.",
            "URL_DOWNLOAD_FAILED"
        );
    }


    // Validate returned media URL

    let parsedVideoUrl;

    try {
        parsedVideoUrl = new URL(videoUrl);
    } catch {
        throw makeError(
            "URL video tidak valid.",
            "URL_DOWNLOAD_FAILED"
        );
    }

    const videoHost = parsedVideoUrl.hostname.toLowerCase();

    if (
        !["http:", "https:"].includes(parsedVideoUrl.protocol) ||
        parsedVideoUrl.username ||
        parsedVideoUrl.password ||
        videoHost === "localhost" ||
        videoHost.endsWith(".localhost") ||
        videoHost.endsWith(".local") ||
        isPrivateIp(videoHost)
    ) {
        throw makeError(
            "URL video tidak valid.",
            "URL_DOWNLOAD_FAILED"
        );
    }


    // Download video as stream

    let media;

    try {
        media = await axios.get(videoUrl, {
            responseType: "stream",
            timeout: 60000,
            maxContentLength: MAX_DOWNLOAD_SIZE,
            maxBodyLength: MAX_DOWNLOAD_SIZE
        });

    } catch (error) {
        console.error(
            "[AUDIS TTDL MEDIA]",
            error.message
        );

        throw makeError(
            "Gagal mengunduh video TikTok.",
            "URL_DOWNLOAD_FAILED"
        );
    }


    // Validate media response

    const contentType = String(
        media.headers["content-type"] || ""
    ).toLowerCase();

    const contentLength = Number(
        media.headers["content-length"] || 0
    );

    if (
        contentType.includes("application/json") ||
        contentType.includes("text/html") ||
        (contentLength && contentLength > MAX_DOWNLOAD_SIZE)
    ) {
        media.data.destroy();

        throw makeError(
            "Respons video tidak valid.",
            "URL_DOWNLOAD_FAILED"
        );
    }


    // Limit downloaded size

    let downloadedBytes = 0;

    const sizeLimiter = new Transform({
        transform(chunk, encoding, callback) {
            downloadedBytes += chunk.length;

            if (downloadedBytes > MAX_DOWNLOAD_SIZE) {
                callback(
                    makeError(
                        "Video terlalu besar.",
                        "MEDIA_TOO_LARGE"
                    )
                );

                return;
            }

            callback(null, chunk);
        }
    });


    // Save temporary file

    try {
        await pipeline(
            media.data,
            sizeLimiter,
            fsSync.createWriteStream(outputPath)
        );

    } catch (error) {
        await fs.rm(outputPath, {
            force: true
        }).catch(() => {});

        throw makeError(
            error.code === "MEDIA_TOO_LARGE"
                ? "Video terlalu besar."
                : "Gagal menyimpan video.",
            error.code === "MEDIA_TOO_LARGE"
                ? "MEDIA_TOO_LARGE"
                : "URL_DOWNLOAD_FAILED"
        );
    }


    const stat = await fs.stat(outputPath);

    if (!stat.size) {
        throw makeError(
            "Video kosong.",
            "URL_DOWNLOAD_FAILED"
        );
    }

    return outputPath;
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

    exif.writeUIntLE(
        jsonBuffer.length,
        14,
        4
    );

    const image = new WebP.Image();

    await image.load(webpBuffer);

    image.exif = exif;

    return await image.save(null);
}


// Build WebP filter
// FPS is intentionally not modified.

function buildWebPFilter(profile) {
    return [
        `scale=${profile.scale}:${profile.scale}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        "format=rgba",
        "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0",
        "setsar=1"
    ].join(",");
}


// AUDIS conversion
// First FFmpeg process creates audio + WebP.
// If WebP exceeds 480 KB, only its visual encoding is repeated.
// Source FPS is preserved.

async function createAudisMedia(
    input,
    tempDir,
    requestedDuration,
    onProgress = async () => {}
) {
    const audioPath = path.join(
        tempDir,
        "audio.ogg"
    );

    const videoPath = path.join(
        tempDir,
        "sticker.webp"
    );

    const stickerDuration = Math.min(
        requestedDuration,
        MAX_STICKER_DURATION
    );


    // Compression profiles
    // Only quality and pixel resolution change.

    const profiles = [
        { quality: 40, scale: 512 },
        { quality: 32, scale: 448 },
        { quality: 25, scale: 384 },
        { quality: 18, scale: 320 },
        { quality: 12, scale: 256 }
    ];


    // FIRST PASS:
    // Audio and WebP in one FFmpeg process.

    try {
        await runFFmpeg([
            "-y",
            "-i", input,

            // Output 1: Audio

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
            audioPath,


            // Output 2: Animated WebP

            "-map", "0:v:0",
            "-an",
            "-t", String(stickerDuration),

            "-vf", buildWebPFilter(profiles[0]),

            // Preserve source frame timestamps.
            "-fps_mode:v", "passthrough",

            "-c:v", "libwebp",
            "-lossless", "0",
            "-compression_level", "4",
            "-quality", String(profiles[0].quality),
            "-loop", "0",

            videoPath
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
                "Video tidak memiliki suara.",
                "NO_AUDIO_TRACK"
            );
        }

        throw error;
    }


    // FFmpeg completed

    await onProgress(4);


    // Read first WebP

    let rawBuffer = await fs.readFile(videoPath);

    let stickerBuffer = await addStickerMetadata(
        rawBuffer
    );


    // First profile meets size requirement

    if (stickerBuffer.length <= MAX_WEBP_SIZE) {
        await onProgress(3);

        return {
            audioPath,
            stickerBuffer
        };
    }


    // FALLBACK:
    // Re-encode only WebP.
    // Audio is never encoded again.

    for (let i = 1; i < profiles.length; i++) {
        const profile = profiles[i];

        await runFFmpeg([
            "-y",
            "-i", input,

            "-map", "0:v:0",
            "-an",

            "-t", String(stickerDuration),

            "-vf", buildWebPFilter(profile),

            "-fps_mode:v", "passthrough",

            "-c:v", "libwebp",
            "-lossless", "0",
            "-compression_level", "4",
            "-quality", String(profile.quality),
            "-loop", "0",

            videoPath
        ]);


        rawBuffer = await fs.readFile(videoPath);

        stickerBuffer = await addStickerMetadata(
            rawBuffer
        );


        if (stickerBuffer.length <= MAX_WEBP_SIZE) {
            await onProgress(3);

            return {
                audioPath,
                stickerBuffer
            };
        }
    }


    throw makeError(
        "Gagal membuat stiker.",
        "STICKER_TOO_LARGE"
    );
}


// Main command

module.exports = async (Joy, msg, reply) => {
    const sender = msg.key.remoteJid;

    let tempDir;
    let processSuccess = false;


    // Reaction helper
    // All reactions target the original command message.

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
                "AUDIS reaction error:",
                error.message
            );
        }
    };


    // Countdown reaction

    const progressEmojis = {
        6: "6️⃣",
        5: "5️⃣",
        4: "4️⃣",
        3: "3️⃣",
        2: "2️⃣",
        1: "1️⃣",
        0: "0️⃣"
    };


    const updateProgress = async (remaining) => {
        const emoji = progressEmojis[remaining];

        if (emoji) {
            await react(emoji);
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
                "Sound Sticker belum terpasang."
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


        // Default duration

        let requestedDuration = MAX_DURATION;

        if (args.lengthToken !== null) {

            if (!/^\d+$/.test(args.lengthToken)) {
                return reply(
                    "Length harus berupa angka."
                );
            }

            requestedDuration = Number(
                args.lengthToken
            );

            if (requestedDuration > MAX_DURATION) {
                return reply(
                    `Maksimal durasi ${MAX_DURATION} detik.`
                );
            }

            if (requestedDuration < 1) {
                return reply(
                    "Minimal durasi 1 detik."
                );
            }
        }


        // Validate TikTok URL

        const mediaUrl = args.url
            ? validateTikTokUrl(args.url)
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


        // Support replying to video

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
                ".audis https://vt.tiktok.com/... 30\n" +
                ".audis https://vt.tiktok.com/..."
            );
        }


        // Initial reaction on original command

        await react("⏳");


        // Start countdown

        await updateProgress(6);


        // Create temporary directory

        tempDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "joy-audis-")
        );


        // Input video path

        const inputPath = path.join(
            tempDir,
            "source-video.mp4"
        );

        let input;


        // MODE 1: TikTok URL through TTDL

        if (mediaUrl) {

            input = await downloadTikTokVideo(
                mediaUrl,
                inputPath
            );

        }


        // MODE 2: WhatsApp video

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

            await fs.writeFile(
                inputPath,
                buffer
            );

            input = inputPath;
        }


        // Download completed

        await updateProgress(5);


        // Combined FFmpeg processing + WebP compression

        const result = await createAudisMedia(
            input,
            tempDir,
            requestedDuration,
            updateProgress
        );


        const audioBuffer = await fs.readFile(
            result.audioPath
        );

        const stickerBuffer = result.stickerBuffer;


        // Validate audio

        if (
            audioBuffer.length < 64 ||
            audioBuffer.subarray(0, 4).toString("ascii") !== "OggS"
        ) {
            throw new Error(
                "Audio tidak valid."
            );
        }


        // Validate WebP and size

        if (
            stickerBuffer.length < 16 ||
            stickerBuffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
            stickerBuffer.subarray(8, 12).toString("ascii") !== "WEBP" ||
            stickerBuffer.length > MAX_WEBP_SIZE
        ) {
            throw new Error(
                "Stiker tidak valid."
            );
        }


        // Validation completed

        await updateProgress(2);


        // One step remaining: send sticker

        await updateProgress(1);


        // Send Sound Sticker

        await Joy.sendSoundSticker(
            sender,
            stickerBuffer,
            audioBuffer,
            {
                quoted: msg
            }
        );


        processSuccess = true;


    } catch (error) {

        console.error(
            "Audis error:",
            error
        );


        // Error reaction on original command

        await react("❌");


        switch (error.code) {

            case "NO_AUDIO_TRACK":
                await reply(
                    "Video tidak memiliki suara."
                );
                break;

            case "INVALID_URL":
                await reply(
                    "Link TikTok tidak valid."
                );
                break;

            case "URL_DOWNLOAD_FAILED":
                await reply(
                    "Gagal mengunduh media."
                );
                break;

            case "MEDIA_TOO_LARGE":
                await reply(
                    "Video terlalu besar."
                );
                break;

            default:
                await reply(
                    "Gagal membuat stiker."
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


        // Completion countdown

        if (processSuccess) {

            // 0: All processing and cleanup completed

            await updateProgress(0);

            // Briefly show 0 before final confirmation

            await new Promise(resolve => {
                setTimeout(resolve, 700);
            });

            // Final green check

            await react("✅");
        }
    }
};
