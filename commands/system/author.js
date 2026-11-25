const AUTHOR = {
  name: "hilal",
  // number: "6281234567890", // tanpa +
  links: [
    { label: "Instagram", url: "https://instagram.com/hihilalal_" },
    { label: "TikTok", url: "https://tiktok.com/@heyhilal_" },
    // { label: "LinkedIn", url: "https://linkedin.com/in/username" },
    // { label: "GitHub", url: "https://github.com/username" },
    // { label: "YouTube", url: "https://youtube.com/@username" },
  ],
};

function buildText() {
  const socials = AUTHOR.links
    .filter(l => l.url)
    .map(l => `• ${l.label}: ${l.url}`);

  return [
    "👤 *AUTHOR*",
    `Nama: ${AUTHOR.name}`,
    "",
    "🔗 *Sosial Media*",
    ...socials,
    "",
    // `💬 WhatsApp: https://wa.me/${AUTHOR.number}`,
  ].join("\n");
}

// function buildVcard() {
//   return [
//     "BEGIN:VCARD",
//     "VERSION:3.0",
//     `FN:${AUTHOR.name}`,
//     `TEL;type=CELL;type=VOICE;waid=${AUTHOR.number}:+${AUTHOR.number}`,
//     "END:VCARD",
//   ].join("\n");
// }

module.exports = async function author(Joy, msg, reply) {
  await reply(buildText());

  await Joy.sendMessage(msg.key.remoteJid, {
    contacts: {
      displayName: AUTHOR.name,
      // contacts: [{ displayName: AUTHOR.name, vcard: buildVcard() }],
    },
  });
};