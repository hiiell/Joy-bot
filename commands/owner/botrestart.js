const { spawn } = require("child_process");

module.exports = async (
    Joy,
    msg,
    reply
) => {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

    const child = spawn(
        npmCommand,
        ["start"],
        {
            cwd: process.cwd(),
            env: {
                ...process.env,
                JOYBOT_RESTART_WAIT: "60000"
            },
            detached: true,
            stdio: "inherit",
            windowsHide: false,
            shell: process.platform === "win32"
        }
    );

    child.once("error", async (error) => {
        console.error("Bot restart gagal:", error.message);

        try {
            await reply("Bot restart gagal dijalankan.");
        } catch {}
    });

    child.once("spawn", async () => {
        child.unref();

        try {
            await reply("Menghentikan bot dan menjalankan ulang...");
        } catch (error) {
            console.error(
                "Gagal mengirim pesan botrestart:",
                error.message
            );
        }

        try {
            await Joy.stop?.();
        } catch (error) {
            console.error(
                "Gagal menutup socket saat botrestart:",
                error.message
            );
        }

        process.exit(0);
    });
};
