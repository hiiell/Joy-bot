
const axios = require("axios");
const WebP = require("node-webpmux");

// Configuration

const PACK_ID = "com.joybot.stickers";
const PACK_NAME = "with joy, by @hihilalal_";

const MAX_DURATION = 30;
const MAX_STICKER_DURATION = 30;
const MAX_WEBP_SIZE = 999 * 1024;
const MAX_DOWNLOAD_SIZE = 80 * 1024 * 1024;

// Adaptive resolution
const SOURCE_SIZE_THRESHOLD = 5 * 1024 * 1024;
const SMALL_SOURCE_SCALE = 512;
const LARGE_SOURCE_SCALE = 320;
const WEBP_COMPRESSION_LEVEL = 3;
const FFMPEG_TIMEOUT_MS = 120000;

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


// Run FFmpeg

async function runFFmpeg(args) {
    return exec(ffmpegPath, [
        "-hide_banner",
        "-loglevel", "error",
        ...args
    ], {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        timeout: FFMPEG_TIMEOUT_MS
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

    const urlMatch = body.match(/https?:\/\/[^\s<>"']+/i);

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

    return { url, lengthToken };
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
        throw makeError("Link tidak valid.", "INVALID_URL");
    }

    if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
    ) {
        throw makeError("Link tidak valid.", "INVALID_URL");
    }

    const hostname = parsed.hostname.toLowerCase();
    const isTikTokHost =
        hostname === "tiktok.com" ||
        hostname.endsWith(".tiktok.com");

    if (!isTikTokHost || isPrivateIp(hostname)) {
        throw makeError("Link TikTok tidak valid.", "INVALID_URL");
    }

    return parsed.href;
}


// Find video URL from TTDL API response

function findVideoUrl(data) {
    const candidates = [];

    function scan(value, keyPath = []) {
        if (typeof value === "string") {
            if (!/^https?:\/\//i.test(value)) return;

            const key = keyPath.join(".").toLowerCase();

            if (/audio|music|cover|avatar|image|photo|thumbnail/.test(key)) {
                return;
            }

            let score = 0;

            if (/nowm|no.?watermark/.test(key)) score += 10;
            if (/video/.test(key)) score += 8;
            if (/play/.test(key)) score += 6;
            if (/hdplay|hd_play/.test(key)) score -= 2;
            if (/download/.test(key)) score += 3;
            if (/\.mp4(?:[?#]|$)/i.test(value)) score += 4;

            if (score > 0) {
                candidates.push({ url: value, score });
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
                String(value.type || value.mimeType || value.mime_type || "")
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


// Download TikTok video

async function downloadTikTokVideo(url, outputPath) {
    let data;

    try {
        const response = await axios.get(TIKTOK_API, {
            params: { url },
            headers: { Accept: "application/json" },
            timeout: 60000,
            maxContentLength: 5 * 1024 * 1024
        });

        data = response.data;
    } catch (error) {
        console.error("[AUDIS TTDL API]", error.message);
        throw makeError("Gagal mengambil data TikTok.", "URL_DOWNLOAD_FAILED");
    }

    if (data?.status === false || data?.success === false) {
        throw makeError(
            data.message || data.error || "Video TikTok tidak tersedia.",
            "URL_DOWNLOAD_FAILED"
        );
    }

    const videoUrl = findVideoUrl(data);

    if (!videoUrl) {
        throw makeError("Video TikTok tidak ditemukan.", "URL_DOWNLOAD_FAILED");
    }

    let parsedVideoUrl;

    try {
        parsedVideoUrl = new URL(videoUrl);
    } catch {
        throw makeError("URL video tidak valid.", "URL_DOWNLOAD_FAILED");
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
        throw makeError("URL video tidak valid.", "URL_DOWNLOAD_FAILED");
    }

    let media;

    try {
        media = await axios.get(videoUrl, {
            responseType: "stream",
            timeout: 60000,
            maxContentLength: MAX_DOWNLOAD_SIZE,
            maxBodyLength: MAX_DOWNLOAD_SIZE
        });
    } catch (error) {
        console.error("[AUDIS TTDL MEDIA]", error.message);
        throw makeError("Gagal mengunduh video TikTok.", "URL_DOWNLOAD_FAILED");
    }

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
        throw makeError("Respons video tidak valid.", "URL_DOWNLOAD_FAILED");
    }

    let downloadedBytes = 0;

    const sizeLimiter = new Transform({
        transform(chunk, encoding, callback) {
            downloadedBytes += chunk.length;

            if (downloadedBytes > MAX_DOWNLOAD_SIZE) {
                callback(makeError("Video terlalu besar.", "MEDIA_TOO_LARGE"));
                return;
            }

            callback(null, chunk);
        }
    });

    try {
        await pipeline(
            media.data,
            sizeLimiter,
            fsSync.createWriteStream(outputPath)
        );
    } catch (error) {
        await fs.rm(outputPath, { force: true }).catch(() => {});
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
        throw makeError("Video kosong.", "URL_DOWNLOAD_FAILED");
    }

    return outputPath;
}


// Sticker metadata

async function addStickerMetadata(webpBuffer) {
    const metadata = {
        "sticker-pack-id": PACK_ID,
        "sticker-pack-name": PACK_NAME
    };

    const jsonBuffer = Buffer.from(JSON.stringify(metadata), "utf8");

    const exifHeader = Buffer.from([
        0x49, 0x49, 0x2A, 0x00,
        0x08, 0x00, 0x00, 0x00,
        0x01, 0x00,
        0x41, 0x57,
        0x07, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x16, 0x00, 0x00, 0x00
    ]);

    const exif = Buffer.concat([exifHeader, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);

    const image = new WebP.Image();
    await image.load(webpBuffer);
    image.exif = exif;

    return image.save(null);
}


// Build WebP filter

function buildWebPFilter(scale, fps) {
    return [
        `fps=${fps}`,
        `scale=${scale}:${scale}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        "format=yuv420p",
        "setsar=1"
    ].join(",");
}


function buildWebPOutputArgs(scale, fps, quality, stickerDuration, videoPath) {
    return [
        "-map", "0:v:0",
        "-an",
        "-t", String(stickerDuration),
        "-vf", buildWebPFilter(scale, fps),
        "-c:v", "libwebp",
        "-lossless", "0",
        "-compression_level", String(WEBP_COMPRESSION_LEVEL),
        "-quality", String(quality),
        "-loop", "0",
        videoPath
    ];
}


async function tryBuildStickerBuffer(videoPath, attempt) {
    const rawBuffer = await fs.readFile(videoPath);

    console.log(
        `[AUDIS] Attempt ${attempt.scale}px ${attempt.fps}fps q${attempt.quality} -> ` +
        `${(rawBuffer.length / 1024).toFixed(1)} KB`
    );

    if (rawBuffer.length > MAX_WEBP_SIZE) {
        return null;
    }

    const stickerBuffer = await addStickerMetadata(rawBuffer);

    return stickerBuffer.length <= MAX_WEBP_SIZE ? stickerBuffer : null;
}


// Optimized AUDIS conversion

async function createAudisMedia(
    input,
    tempDir,
    requestedDuration,
    onProgress = async () => {}
) {
    const audioPath = path.join(tempDir, "audio.ogg");
    const videoPath = path.join(tempDir, "sticker.webp");

    const stickerDuration = Math.min(
        requestedDuration,
        MAX_STICKER_DURATION
    );

    const sourceStat = await fs.stat(input);

    let attempts;

    if (sourceStat.size <= SOURCE_SIZE_THRESHOLD && stickerDuration <= 5) {
        attempts = [
            { scale: SMALL_SOURCE_SCALE, fps: 24, quality: 50 },
            { scale: SMALL_SOURCE_SCALE, fps: 20, quality: 36 },
            { scale: LARGE_SOURCE_SCALE, fps: 18, quality: 28 },
            { scale: 256, fps: 15, quality: 22 },
            { scale: 224, fps: 12, quality: 16 }
        ];
    } else if (stickerDuration <= 15) {
        attempts = [
            { scale: SMALL_SOURCE_SCALE, fps: 18, quality: 40 },
            { scale: LARGE_SOURCE_SCALE, fps: 15, quality: 30 },
            { scale: 256, fps: 15, quality: 24 },
            { scale: 224, fps: 12, quality: 18 },
            { scale: 192, fps: 10, quality: 12 }
        ];
    } else {
        attempts = [
            { scale: LARGE_SOURCE_SCALE, fps: 12, quality: 24 },
            { scale: 256, fps: 10, quality: 18 },
            { scale: 224, fps: 10, quality: 14 },
            { scale: 192, fps: 8, quality: 10 },
            { scale: 160, fps: 8, quality: 8 }
        ];
    }

    const firstAttempt = attempts[0];

    console.log(
        `[AUDIS] Source ${(sourceStat.size / 1024 / 1024).toFixed(2)} MB; ` +
        `start ${firstAttempt.scale}px ${firstAttempt.fps}fps q${firstAttempt.quality}; ` +
        `target ${Math.round(MAX_WEBP_SIZE / 1024)} KB`
    );

    // FIRST PASS: audio + WebP

    try {
        await runFFmpeg([
            "-y",
            "-i", input,

            // Output 1: OGG audio
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

            // Output 2: animated WebP
            ...buildWebPOutputArgs(
                firstAttempt.scale,
                firstAttempt.fps,
                firstAttempt.quality,
                stickerDuration,
                videoPath
            )
        ]);
    } catch (error) {
        const stderr = String(error.stderr || error.message || "");

        if (
            /matches no streams|does not contain any stream|Stream map.*matches no streams/i.test(stderr)
        ) {
            throw makeError("Video tidak memiliki suara.", "NO_AUDIO_TRACK");
        }

        throw error;
    }

    await onProgress(4);

    let stickerBuffer = await tryBuildStickerBuffer(videoPath, firstAttempt);

    if (stickerBuffer) {
        await onProgress(3);
        return { audioPath, stickerBuffer };
    }

    // Re-encode WebP only with lower scale/fps/quality

    for (let i = 1; i < attempts.length; i++) {
        const attempt = attempts[i];

        await runFFmpeg([
            "-y",
            "-i", input,
            ...buildWebPOutputArgs(
                attempt.scale,
                attempt.fps,
                attempt.quality,
                stickerDuration,
                videoPath
            )
        ]);

        stickerBuffer = await tryBuildStickerBuffer(videoPath, attempt);

        if (stickerBuffer) {
            await onProgress(3);
            return { audioPath, stickerBuffer };
        }
    }

    throw makeError("Gagal membuat stiker.", "STICKER_TOO_LARGE");
}


// Main command

module.exports = async (Joy, msg, reply) => {
    const sender = msg.key.remoteJid;

    let tempDir;
    let processSuccess = false;

    // Reaction helper: original command message

    const react = async (emoji) => {
        try {
            await Joy.sendMessage(sender, {
                react: {
                    text: emoji,
                    key: msg.key
                }
            });
        } catch (error) {
            console.error("Reaction error:", error.message);
        }
    };

    // Countdown reactions on original command

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
        const emoji = progressEmojis[remaining] || String(remaining);
        await react(emoji);
    };

    try {
        // Check FFmpeg

        if (!ffmpegPath) {
            throw new Error("FFmpeg tidak ditemukan.");
        }

        // Check Sound Sticker support

        if (typeof Joy.sendSoundSticker !== "function") {
            throw new Error("Sound Sticker belum terpasang.");
        }

        // Normalize current message

        const currentContent =
            normalizeMessageContent(msg.message) || msg.message;

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
                return reply("Length harus berupa angka.");
            }

            requestedDuration = Number(args.lengthToken);

            if (requestedDuration > MAX_DURATION) {
                return reply(`Maksimal durasi ${MAX_DURATION} detik.`);
            }

            if (requestedDuration < 1) {
                return reply("Minimal durasi 1 detik.");
            }
        }

        // Validate TikTok URL

        const mediaUrl = args.url
            ? validateTikTokUrl(args.url)
            : null;

        // Get current or quoted WhatsApp video

        const context =
            currentContent.extendedTextMessage?.contextInfo ||
            currentContent.imageMessage?.contextInfo ||
            currentContent.videoMessage?.contextInfo;

        let targetMessage = {
            ...msg,
            message: currentContent
        };

        let videoMessage = currentContent.videoMessage;

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

        // Start reaction on user's command

        await updateProgress(6);

        // Create temporary directory

        tempDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "joy-audis-")
        );

        const inputPath = path.join(
            tempDir,
            "source-video.mp4"
        );

        let input;

        // MODE 1: TikTok URL

        if (mediaUrl) {
            input = await downloadTikTokVideo(
                mediaUrl,
                inputPath
            );
        } else {
            // MODE 2: WhatsApp video

            const buffer = await downloadMediaMessage(
                targetMessage,
                "buffer",
                {},
                {
                    logger: pino({ level: "silent" }),
                    reuploadRequest: Joy.updateMediaMessage
                }
            );

            await fs.writeFile(inputPath, buffer);
            input = inputPath;
        }

        await updateProgress(5);

        // Create OGG + WebP

        const result = await createAudisMedia(
            input,
            tempDir,
            requestedDuration,
            updateProgress
        );

        const audioBuffer = await fs.readFile(result.audioPath);
        const stickerBuffer = result.stickerBuffer;

        // Validate OGG

        if (
            audioBuffer.length < 64 ||
            audioBuffer.subarray(0, 4).toString("ascii") !== "OggS"
        ) {
            throw new Error("Audio tidak valid.");
        }

        // Validate WebP

        if (
            stickerBuffer.length < 16 ||
            stickerBuffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
            stickerBuffer.subarray(8, 12).toString("ascii") !== "WEBP" ||
            stickerBuffer.length > MAX_WEBP_SIZE
        ) {
            throw new Error("Stiker tidak valid.");
        }

        await updateProgress(2);

        // Send Sound Sticker

        await Joy.sendSoundSticker(
            sender,
            stickerBuffer,
            audioBuffer,
            { quoted: msg }
        );

        await updateProgress(1);

        processSuccess = true;

    } catch (error) {
        console.error("Audis error:", error);

        await updateProgress("❌");

        switch (error.code) {
            case "NO_AUDIO_TRACK":
                await reply("Video tidak memiliki suara.");
                break;

            case "INVALID_URL":
                await reply("Link TikTok tidak valid.");
                break;

            case "URL_DOWNLOAD_FAILED":
                await reply("Gagal mengunduh media.");
                break;

            case "MEDIA_TOO_LARGE":
                await reply("Video terlalu besar.");
                break;

            case "STICKER_TOO_LARGE":
                await reply("Gagal membuat stiker.");
                break;

            default:
                await reply("Gagal membuat stiker.");
        }

    } finally {
        // Cleanup temporary files

        if (tempDir) {
            await fs.rm(tempDir, {
                recursive: true,
                force: true
            }).catch(error => {
                console.error("Temp cleanup error:", error.message);
            });
        }

        // 0 then green check after success

        if (processSuccess) {
            await updateProgress(0);

            await new Promise(resolve => setTimeout(resolve, 700));

            await react("✅");
        }
    }
};
