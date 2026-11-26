const quotes = [
    "mangatt",
    "mangat",
    "jangan menyerah",
    "Jangan menyerahh",
    "males",
    "mangattttt",
    " ofsann2n29 91hans  oa PAOsdkpoakposdk ",
    "oke",
    "semangat",
];

module.exports = async (Joy, msg, reply) => {
    const randomQuote =
        quotes[Math.floor(Math.random() * quotes.length)];

    await reply(`_"${randomQuote}"_`);
};
