const pino = require("pino");
const {
    proto,
    generateWAMessage,
    prepareWAMessageMedia
} = require("baileys");

const SOUND_STICKER_AUDIO_FIELD = 26;
const SOUND_STICKER_AUDIO_TAG =
    (SOUND_STICKER_AUDIO_FIELD << 3) | 2;

let encoderPatched = false;

/**
 * Baileys 6.7.17's bundled StickerMessage schema predates
 * StickerMessage.audioMessage (protobuf field 26).
 *
 * Keep Baileys' existing sticker encoder for every known field, then append
 * the encoded AudioMessage as field 26. This only changes StickerMessage
 * encoding; all other protobuf messages keep their original encoders.
 */
function installSoundStickerProtoPatch() {
    if (encoderPatched) return;

    const stickerProto = proto?.Message?.StickerMessage;
    const audioProto = proto?.Message?.AudioMessage;

    if (
        !stickerProto ||
        typeof stickerProto.encode !== "function" ||
        !audioProto ||
        typeof audioProto.encode !== "function"
    ) {
        throw new Error(
            "Versi Baileys ini tidak menyediakan encoder StickerMessage/AudioMessage yang dibutuhkan."
        );
    }

    const originalEncode = stickerProto.encode;

    if (originalEncode.__joySoundStickerPatched) {
        encoderPatched = true;
        return;
    }

    function encodeStickerWithAudio(message, writer) {
        const output = originalEncode.call(this, message, writer);

        if (message?.audioMessage) {
            const encodedAudio = audioProto
                .encode(message.audioMessage)
                .finish();

            // protobuf: field 26, wire type 2 (length-delimited)
            output
                .uint32(SOUND_STICKER_AUDIO_TAG)
                .bytes(encodedAudio);
        }

        return output;
    }

    Object.defineProperty(encodeStickerWithAudio, "__joySoundStickerPatched", {
        value: true
    });

    stickerProto.encode = encodeStickerWithAudio;
    encoderPatched = true;
}

/**
 * Uploads the WebP sticker and OGG/Opus audio independently, then sends
 * a single WhatsApp StickerMessage containing audioMessage.
 */
async function sendSoundStickerMessage(
    Joy,
    jid,
    stickerBuffer,
    audioBuffer,
    options = {}
) {
    if (!Buffer.isBuffer(stickerBuffer) || stickerBuffer.length === 0) {
        throw new TypeError("Buffer stiker WebP tidak valid.");
    }

    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
        throw new TypeError("Buffer audio OGG tidak valid.");
    }

    if (
        typeof Joy?.waUploadToServer !== "function" ||
        typeof Joy?.relayMessage !== "function"
    ) {
        throw new Error(
            "Socket Baileys tidak menyediakan waUploadToServer/relayMessage."
        );
    }

    if (!Joy.user?.id) {
        throw new Error(
            "Identitas akun JOYBOT belum tersedia. Pastikan WhatsApp sudah ONLINE."
        );
    }

    installSoundStickerProtoPatch();

    const logger = pino({ level: "silent" });

    const mediaOptions = {
        logger,
        upload: Joy.waUploadToServer
    };

    // Build the normal sticker WAMessage (including quoted-message context)
    // and prepare its audio attachment using Baileys' encrypted media pipeline.
    const [stickerWAMessage, preparedAudio] = await Promise.all([
        generateWAMessage(
            jid,
            { sticker: stickerBuffer, isAnimated: true },
            {
                ...mediaOptions,
                userJid: Joy.user.id,
                quoted: options.quoted
            }
        ),
        prepareWAMessageMedia(
            {
                audio: audioBuffer,
                mimetype: "audio/ogg; codecs=opus",
                ptt: true
            },
            mediaOptions
        )
    ]);

    const stickerMessage = stickerWAMessage.message?.stickerMessage;
    const audioMessage = preparedAudio?.audioMessage;

    if (!stickerMessage || !audioMessage) {
        throw new Error(
            "Baileys gagal menyiapkan media stiker atau audio."
        );
    }

    // Attach prepared AudioMessage before protobuf serialization.
    stickerMessage.audioMessage = audioMessage;

    // Relay the single combined StickerMessage to WhatsApp.
    await Joy.relayMessage(
        jid,
        stickerWAMessage.message,
        {
            messageId: stickerWAMessage.key.id
        }
    );

    return stickerWAMessage;
}

module.exports = sendSoundStickerMessage;
